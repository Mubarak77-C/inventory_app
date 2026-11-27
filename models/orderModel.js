// models/orderModel.js
const pool = require("../db/pool");

const VALID_STATUSES = new Set([
  "PENDING",
  "PREPARING",
  "READY",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
]);

const VALID_PAYMENT_METHODS = new Set(["CASH", "CARD", "UPI"]);

const ALLOWED_TRANSITIONS = {
  PENDING: new Set(["PREPARING", "CANCELLED", "COMPLETED"]),
  PREPARING: new Set(["READY", "CANCELLED", "COMPLETED"]),
  READY: new Set(["SERVED", "CANCELLED", "COMPLETED"]),
  SERVED: new Set(["COMPLETED"]),
  COMPLETED: new Set([]),
  CANCELLED: new Set([]),
};

function createDomainError(message, code, statusCode = 400, meta = {}) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  Object.assign(err, meta);
  return err;
}

function normalizeAndAggregateItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw createDomainError(
      "Order must contain at least one item.",
      "INVALID_ORDER_ITEMS",
      400,
    );
  }

  const aggregated = new Map();

  for (const entry of rawItems) {
    const itemId = Number(entry?.itemId ?? entry?.item_id);
    const quantity = Number(entry?.quantity);

    if (!Number.isInteger(itemId) || itemId <= 0) {
      throw createDomainError(
        `Invalid itemId: ${entry?.itemId ?? entry?.item_id}. Must be a positive integer.`,
        "INVALID_ITEM_ID",
        400,
      );
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw createDomainError(
        `Invalid quantity for item #${itemId}: ${entry?.quantity}. Quantity must be greater than 0.`,
        "INVALID_QUANTITY",
        400,
      );
    }

    aggregated.set(itemId, (aggregated.get(itemId) || 0) + quantity);
  }

  // Deterministic itemId order prevents multi-item lock deadlocks
  return Array.from(aggregated.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([itemId, quantity]) => ({
      itemId,
      quantity,
    }));
}

async function getOrderWithItemsByIdempotencyKey(clientOrPool, idempotencyKey) {
  const orderRes = await clientOrPool.query(
    `SELECT * FROM public.orders WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  const order = orderRes.rows[0];
  if (!order) return null;

  const itemsRes = await clientOrPool.query(
    `SELECT * FROM public.order_items WHERE order_id = $1 ORDER BY id ASC`,
    [order.id],
  );

  return {
    order,
    items: itemsRes.rows,
  };
}

async function getOrderWithItemsById(clientOrPool, orderId) {
  const orderRes = await clientOrPool.query(
    `SELECT * FROM public.orders WHERE id = $1`,
    [orderId],
  );
  const order = orderRes.rows[0];
  if (!order) return null;

  const itemsRes = await clientOrPool.query(
    `SELECT * FROM public.order_items WHERE order_id = $1 ORDER BY id ASC`,
    [order.id],
  );

  return {
    order,
    items: itemsRes.rows,
  };
}

/**
 * Atomically creates an order, snapshots item name & price, deducts items.stock_count,
 * and writes the initial PENDING entry to order_status_history.
 */
async function createOrder({
  idempotencyKey,
  items,
  createdBy = null,
  status = "PENDING",
  paymentMethod = null,
  paymentReference = null,
  customerId = null,
}) {
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length === 0
  ) {
    throw createDomainError(
      "idempotencyKey is required and must be a non-empty string.",
      "MISSING_IDEMPOTENCY_KEY",
      400,
    );
  }

  const normalizedStatus =
    typeof status === "string" ? status.trim().toUpperCase() : "PENDING";

  if (!VALID_STATUSES.has(normalizedStatus)) {
    throw createDomainError(
      `Invalid order status: ${status}.`,
      "INVALID_ORDER_STATUS",
      400,
    );
  }

  let normalizedPaymentMethod = null;
  let cleanPaymentReference = null;

  if (normalizedStatus === "COMPLETED") {
    normalizedPaymentMethod =
      typeof paymentMethod === "string"
        ? paymentMethod.trim().toUpperCase()
        : "";

    if (!VALID_PAYMENT_METHODS.has(normalizedPaymentMethod)) {
      throw createDomainError(
        "Payment method is required for quick payment (CASH, CARD, or UPI).",
        "PAYMENT_METHOD_REQUIRED",
        400,
      );
    }

    cleanPaymentReference =
      typeof paymentReference === "string" && paymentReference.trim().length > 0
        ? paymentReference.trim().slice(0, 120)
        : null;
  }

  const cleanKey = idempotencyKey.trim();
  const requestedItems = normalizeAndAggregateItems(items);
  const actorId =
    Number.isInteger(Number(createdBy)) && Number(createdBy) > 0
      ? Number(createdBy)
      : null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Idempotency check before touching customer or stock
    const existing = await getOrderWithItemsByIdempotencyKey(client, cleanKey);
    if (existing) {
      await client.query("COMMIT");
      return { ...existing, idempotentReplay: true };
    }

    // 1b. Validate optional customerId (null/empty = walk-in order)
    let resolvedCustomerId = null;
    if (
      customerId !== undefined &&
      customerId !== null &&
      String(customerId).trim() !== ""
    ) {
      const parsedCustomerId = Number(customerId);
      if (!Number.isInteger(parsedCustomerId) || parsedCustomerId <= 0) {
        throw createDomainError(
          "Invalid customerId.",
          "INVALID_CUSTOMER_ID",
          400,
        );
      }

      const custRes = await client.query(
        `SELECT id FROM public.customers WHERE id = $1`,
        [parsedCustomerId],
      );
      if (custRes.rowCount === 0) {
        throw createDomainError(
          `Customer #${parsedCustomerId} does not exist.`,
          "CUSTOMER_NOT_FOUND",
          404,
        );
      }
      resolvedCustomerId = parsedCustomerId;
    }

    // 2. Atomically deduct stock for each requested item
    const lineSnapshots = [];
    let totalAmount = 0;

    for (const reqItem of requestedItems) {
      const updateRes = await client.query(
        `UPDATE public.items
         SET stock_count = stock_count - $1
         WHERE id = $2 AND stock_count >= $1
         RETURNING id, name, price, stock_count`,
        [reqItem.quantity, reqItem.itemId],
      );

      if (updateRes.rowCount === 0) {
        const existsRes = await client.query(
          `SELECT id, name, stock_count FROM public.items WHERE id = $1`,
          [reqItem.itemId],
        );

        if (existsRes.rowCount === 0) {
          throw createDomainError(
            `Item #${reqItem.itemId} does not exist.`,
            "ITEM_NOT_FOUND",
            404,
            { itemId: reqItem.itemId },
          );
        }

        const currentStock = existsRes.rows[0].stock_count;
        const isOutOfStock = currentStock === 0;
        const errorCode = isOutOfStock ? "OUT_OF_STOCK" : "INSUFFICIENT_STOCK";
        const errorMessage = isOutOfStock
          ? `"${existsRes.rows[0].name}" (item #${reqItem.itemId}) is out of stock (0 available).`
          : `Insufficient stock for "${existsRes.rows[0].name}" (item #${reqItem.itemId}). Requested ${reqItem.quantity}, available ${currentStock}.`;

        throw createDomainError(errorMessage, errorCode, 409, {
          itemId: reqItem.itemId,
          requested: reqItem.quantity,
          available: currentStock,
        });
      }

      const dbItem = updateRes.rows[0];
      const unitPrice = Number(dbItem.price);
      const lineTotal = Number((unitPrice * reqItem.quantity).toFixed(2));
      totalAmount = Number((totalAmount + lineTotal).toFixed(2));

      lineSnapshots.push({
        itemId: dbItem.id,
        itemName: dbItem.name,
        unitPrice: dbItem.price,
        quantity: reqItem.quantity,
        lineTotal: lineTotal.toFixed(2),
      });
    }

    // 3. Insert order header (with PAID fields when quick-paid & optional customer_id)
    const isPaid = normalizedStatus === "COMPLETED";
    const orderInsertRes = await client.query(
      `INSERT INTO public.orders (
         idempotency_key,
         status,
         total_amount,
         payment_method,
         payment_status,
         payment_reference,
         paid_at,
         created_by,
         customer_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        cleanKey,
        normalizedStatus,
        totalAmount.toFixed(2),
        isPaid ? normalizedPaymentMethod : null,
        isPaid ? "PAID" : "UNPAID",
        isPaid ? cleanPaymentReference : null,
        isPaid ? new Date() : null,
        actorId,
        resolvedCustomerId,
      ],
    );
    const createdOrder = orderInsertRes.rows[0];

    // 4. Log initial order creation in audit history
    const initialReason = isPaid
      ? `Quick paid via ${normalizedPaymentMethod}`
      : "Order punched";

    await client.query(
      `INSERT INTO public.order_status_history
         (order_id, from_status, to_status, changed_by, reason)
       VALUES ($1, NULL, $2, $3, $4)`,
      [createdOrder.id, normalizedStatus, actorId, initialReason],
    );

    // 5. Insert order_items snapshot rows
    const insertedItems = [];
    for (const snap of lineSnapshots) {
      const itemInsertRes = await client.query(
        `INSERT INTO public.order_items
           (order_id, item_id, item_name, unit_price, quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          createdOrder.id,
          snap.itemId,
          snap.itemName,
          snap.unitPrice,
          snap.quantity,
          snap.lineTotal,
        ],
      );
      insertedItems.push(itemInsertRes.rows[0]);
    }

    await client.query("COMMIT");

    return {
      order: createdOrder,
      items: insertedItems,
      idempotentReplay: false,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Failed to rollback order transaction:", rollbackErr);
    }

    if (
      err.code === "23505" &&
      err.constraint === "orders_idempotency_key_key"
    ) {
      const existingAfterRace = await getOrderWithItemsByIdempotencyKey(
        pool,
        cleanKey,
      );
      if (existingAfterRace) {
        return { ...existingAfterRace, idempotentReplay: true };
      }
    }

    throw err;
  } finally {
    client.release();
  }
}

async function listOrders(limit = 50) {
  const parsedLimit = Number(limit);
  const safeLimit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 200)
      : 50;

  const { rows } = await pool.query(
    `SELECT
       o.id,
       o.idempotency_key,
       o.status,
       o.total_amount,
       o.payment_method,
       o.payment_status,
       o.payment_reference,
       o.paid_at,
       o.created_by,
       o.customer_id,
       c.name AS customer_name,
       c.phone AS customer_phone,
       c.email AS customer_email,
       c.address_line1 AS customer_address_line1,
       c.address_line2 AS customer_address_line2,
       c.extra_details AS customer_extra_details,
       o.created_at,
       COALESCE(
         json_agg(
           json_build_object(
             'id', oi.id,
             'item_id', oi.item_id,
             'item_name', oi.item_name,
             'unit_price', oi.unit_price,
             'quantity', oi.quantity,
             'line_total', oi.line_total
           ) ORDER BY oi.id ASC
         ) FILTER (WHERE oi.id IS NOT NULL),
         '[]'::json
       ) AS items
     FROM public.orders o
     LEFT JOIN public.customers c ON c.id = o.customer_id
     LEFT JOIN public.order_items oi ON oi.order_id = o.id
     GROUP BY o.id, c.id
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT $1`,
    [safeLimit],
  );

  return rows;
}
/**
 * Transitions an order's status inside a transaction.
 * - Restocks items when moving to CANCELLED.
 * - Requires and records payment_method (CASH, CARD, UPI) when moving to COMPLETED.
 * - Appends an audit row to order_status_history.
 */
async function transitionOrderStatus({
  orderId,
  nextStatus,
  changedBy = null,
  reason = null,
  paymentMethod = null,
  paymentReference = null,
}) {
  const numericOrderId = Number(orderId);
  if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
    throw createDomainError(
      `Invalid orderId: ${orderId}. Must be a positive integer.`,
      "INVALID_ORDER_ID",
      400,
    );
  }

  const normalizedStatus =
    typeof nextStatus === "string" ? nextStatus.trim().toUpperCase() : "";

  if (!VALID_STATUSES.has(normalizedStatus)) {
    throw createDomainError(
      `Invalid target status: "${nextStatus}".`,
      "INVALID_ORDER_STATUS",
      400,
    );
  }

  const actorId =
    Number.isInteger(Number(changedBy)) && Number(changedBy) > 0
      ? Number(changedBy)
      : null;

  const cleanReason =
    typeof reason === "string" && reason.trim().length > 0
      ? reason.trim().slice(0, 250)
      : null;

  let normalizedPaymentMethod = null;
  let cleanPaymentReference = null;

  if (normalizedStatus === "COMPLETED") {
    normalizedPaymentMethod =
      typeof paymentMethod === "string"
        ? paymentMethod.trim().toUpperCase()
        : "";

    if (!VALID_PAYMENT_METHODS.has(normalizedPaymentMethod)) {
      throw createDomainError(
        "Payment method is required when completing an order (CASH, CARD, or UPI).",
        "PAYMENT_METHOD_REQUIRED",
        400,
      );
    }

    cleanPaymentReference =
      typeof paymentReference === "string" && paymentReference.trim().length > 0
        ? paymentReference.trim().slice(0, 120)
        : null;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the order row to serialize concurrent status/cancellation/payment requests
    const lockRes = await client.query(
      `SELECT * FROM public.orders WHERE id = $1 FOR UPDATE`,
      [numericOrderId],
    );

    if (lockRes.rowCount === 0) {
      throw createDomainError(
        `Order #${numericOrderId} not found.`,
        "ORDER_NOT_FOUND",
        404,
        { orderId: numericOrderId },
      );
    }

    const currentOrder = lockRes.rows[0];
    const currentStatus = currentOrder.status;
    const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || new Set();

    if (!allowedNext.has(normalizedStatus)) {
      throw createDomainError(
        `Cannot transition order #${numericOrderId} from ${currentStatus} to ${normalizedStatus}.`,
        "INVALID_STATUS_TRANSITION",
        409,
        {
          orderId: numericOrderId,
          currentStatus,
          attemptedStatus: normalizedStatus,
        },
      );
    }

    let restoredItems = [];

    if (normalizedStatus === "CANCELLED") {
      const lineItemsRes = await client.query(
        `SELECT item_id, quantity
         FROM public.order_items
         WHERE order_id = $1
         ORDER BY item_id ASC`,
        [numericOrderId],
      );

      for (const line of lineItemsRes.rows) {
        const restockRes = await client.query(
          `UPDATE public.items
           SET stock_count = stock_count + $1
           WHERE id = $2
           RETURNING id, stock_count`,
          [line.quantity, line.item_id],
        );

        if (restockRes.rowCount > 0) {
          restoredItems.push({
            itemId: restockRes.rows[0].id,
            restockedQuantity: line.quantity,
            newStockCount: restockRes.rows[0].stock_count,
          });
        }
      }
    }

    if (normalizedStatus === "COMPLETED") {
      await client.query(
        `UPDATE public.orders
         SET status = $1,
             payment_method = $2,
             payment_status = 'PAID',
             payment_reference = $3,
             paid_at = NOW()
         WHERE id = $4`,
        [
          normalizedStatus,
          normalizedPaymentMethod,
          cleanPaymentReference,
          numericOrderId,
        ],
      );
    } else {
      await client.query(
        `UPDATE public.orders
         SET status = $1
         WHERE id = $2`,
        [normalizedStatus, numericOrderId],
      );
    }

    const historyReason =
      cleanReason ||
      (normalizedStatus === "COMPLETED"
        ? `Paid via ${normalizedPaymentMethod}`
        : null);

    await client.query(
      `INSERT INTO public.order_status_history
         (order_id, from_status, to_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [numericOrderId, currentStatus, normalizedStatus, actorId, historyReason],
    );

    const updated = await getOrderWithItemsById(client, numericOrderId);

    await client.query("COMMIT");

    return {
      order: updated.order,
      items: updated.items,
      restoredItems,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Failed to rollback order status transition:", rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

const EDITABLE_STATUSES = new Set(["PENDING", "PREPARING", "READY", "SERVED"]);

/**
 * Atomically updates an active order's line items, adjusts items.stock_count by delta,
 * recalculates orders.total_amount, and logs the edit in order_status_history.
 */
async function editOrderItems({
  orderId,
  items,
  changedBy = null,
  reason = null,
}) {
  const numericOrderId = Number(orderId);
  if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
    throw createDomainError(
      `Invalid orderId: ${orderId}. Must be a positive integer.`,
      "INVALID_ORDER_ID",
      400,
    );
  }

  const nextItems = normalizeAndAggregateItems(items);
  const actorId =
    Number.isInteger(Number(changedBy)) && Number(changedBy) > 0
      ? Number(changedBy)
      : null;

  const cleanReason =
    typeof reason === "string" && reason.trim().length > 0
      ? reason.trim().slice(0, 250)
      : null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Lock the order row first
    const orderLockRes = await client.query(
      `SELECT * FROM public.orders WHERE id = $1 FOR UPDATE`,
      [numericOrderId],
    );

    if (orderLockRes.rowCount === 0) {
      throw createDomainError(
        `Order #${numericOrderId} not found.`,
        "ORDER_NOT_FOUND",
        404,
        { orderId: numericOrderId },
      );
    }

    const currentOrder = orderLockRes.rows[0];
    if (!EDITABLE_STATUSES.has(currentOrder.status)) {
      throw createDomainError(
        `Cannot edit order #${numericOrderId} while status is ${currentOrder.status}.`,
        "ORDER_NOT_EDITABLE",
        409,
        { orderId: numericOrderId, currentStatus: currentOrder.status },
      );
    }

    // 2. Fetch existing order_items
    const existingItemsRes = await client.query(
      `SELECT item_id, quantity
       FROM public.order_items
       WHERE order_id = $1
       ORDER BY item_id ASC`,
      [numericOrderId],
    );

    const oldQtyByItem = new Map();
    for (const row of existingItemsRes.rows) {
      oldQtyByItem.set(Number(row.item_id), Number(row.quantity));
    }

    const newQtyByItem = new Map();
    for (const entry of nextItems) {
      newQtyByItem.set(entry.itemId, entry.quantity);
    }

    // 3. Collect all itemIds involved in deterministic ascending order to avoid deadlocks
    const allItemIds = Array.from(
      new Set([...oldQtyByItem.keys(), ...newQtyByItem.keys()]),
    ).sort((a, b) => a - b);

    const stockChanges = [];
    const catalogById = new Map();

    for (const itemId of allItemIds) {
      const itemRes = await client.query(
        `SELECT id, name, price, stock_count
         FROM public.items
         WHERE id = $1
         FOR UPDATE`,
        [itemId],
      );

      if (newQtyByItem.has(itemId) && itemRes.rowCount === 0) {
        throw createDomainError(
          `Item #${itemId} does not exist.`,
          "ITEM_NOT_FOUND",
          404,
          { itemId },
        );
      }

      if (itemRes.rowCount > 0) {
        catalogById.set(itemId, itemRes.rows[0]);
      }

      const oldQty = oldQtyByItem.get(itemId) || 0;
      const newQty = newQtyByItem.get(itemId) || 0;
      const delta = newQty - oldQty;

      if (delta > 0) {
        const deductRes = await client.query(
          `UPDATE public.items
           SET stock_count = stock_count - $1
           WHERE id = $2 AND stock_count >= $1
           RETURNING id, stock_count`,
          [delta, itemId],
        );

        if (deductRes.rowCount === 0) {
          const dbItem = catalogById.get(itemId);
          const avail = dbItem ? Number(dbItem.stock_count) : 0;
          const code = avail === 0 ? "OUT_OF_STOCK" : "INSUFFICIENT_STOCK";
          const msg =
            avail === 0
              ? `"${dbItem.name}" (item #${itemId}) is out of stock (0 available).`
              : `Insufficient stock for "${dbItem.name}" (item #${itemId}). Need +${delta}, available ${avail}.`;

          throw createDomainError(msg, code, 409, {
            itemId,
            requestedAdditional: delta,
            available: avail,
          });
        }

        stockChanges.push({
          itemId,
          delta: -delta,
          newStockCount: deductRes.rows[0].stock_count,
        });
      } else if (delta < 0) {
        const restoreQty = Math.abs(delta);
        const restoreRes = await client.query(
          `UPDATE public.items
           SET stock_count = stock_count + $1
           WHERE id = $2
           RETURNING id, stock_count`,
          [restoreQty, itemId],
        );

        if (restoreRes.rowCount > 0) {
          stockChanges.push({
            itemId,
            delta: restoreQty,
            newStockCount: restoreRes.rows[0].stock_count,
          });
        }
      }
    }

    // 4. Replace line items and recompute order total from DB prices
    await client.query(`DELETE FROM public.order_items WHERE order_id = $1`, [
      numericOrderId,
    ]);

    let totalAmount = 0;
    const summaryParts = [];

    for (const entry of nextItems) {
      const dbItem = catalogById.get(entry.itemId);
      const unitPrice = Number(dbItem.price);
      const lineTotal = Number((unitPrice * entry.quantity).toFixed(2));
      totalAmount = Number((totalAmount + lineTotal).toFixed(2));

      await client.query(
        `INSERT INTO public.order_items
           (order_id, item_id, item_name, unit_price, quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          numericOrderId,
          dbItem.id,
          dbItem.name,
          dbItem.price,
          entry.quantity,
          lineTotal.toFixed(2),
        ],
      );

      summaryParts.push(`${dbItem.name} x${entry.quantity}`);
    }

    await client.query(
      `UPDATE public.orders
       SET total_amount = $1
       WHERE id = $2`,
      [totalAmount.toFixed(2), numericOrderId],
    );

    // 5. Audit log entry inside the same transaction
    const auditReason =
      cleanReason || `Order edited: ${summaryParts.join(", ")}`;

    await client.query(
      `INSERT INTO public.order_status_history
         (order_id, from_status, to_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        numericOrderId,
        currentOrder.status,
        currentOrder.status,
        actorId,
        auditReason.slice(0, 250),
      ],
    );

    const updated = await getOrderWithItemsById(client, numericOrderId);
    await client.query("COMMIT");

    return {
      order: updated.order,
      items: updated.items,
      stockChanges,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Failed to rollback order edit:", rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getOrderInvoiceById(orderId) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const orderRes = await pool.query(
    `SELECT
       o.id,
       o.idempotency_key,
       o.status,
       o.total_amount,
       o.payment_method,
       o.payment_status,
       o.payment_reference,
       o.paid_at,
       o.created_by,
       o.created_at,
       o.customer_id,
       c.name AS customer_name,
       c.phone AS customer_phone,
       c.email AS customer_email,
       c.address_line1 AS customer_address_line1,
       c.address_line2 AS customer_address_line2,
       c.extra_details AS customer_extra_details
     FROM public.orders o
     LEFT JOIN public.customers c ON c.id = o.customer_id
     WHERE o.id = $1`,
    [id],
  );

  if (orderRes.rowCount === 0) {
    return null;
  }

  const itemsRes = await pool.query(
    `SELECT id, item_id, item_name, unit_price, quantity, line_total
     FROM public.order_items
     WHERE order_id = $1
     ORDER BY id ASC`,
    [id],
  );

  return {
    order: orderRes.rows[0],
    items: itemsRes.rows,
  };
}
module.exports = {
  createOrder,
  getOrderWithItemsByIdempotencyKey,
  listOrders,
  transitionOrderStatus,
  editOrderItems,
  getOrderInvoiceById,
};
