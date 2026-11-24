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
  PENDING: new Set(["PREPARING", "CANCELLED"]),
  PREPARING: new Set(["READY", "CANCELLED"]),
  READY: new Set(["SERVED", "CANCELLED"]),
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

  if (!VALID_STATUSES.has(status)) {
    throw createDomainError(
      `Invalid order status: ${status}.`,
      "INVALID_ORDER_STATUS",
      400,
    );
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

    // 1. Idempotency check before touching stock
    const existing = await getOrderWithItemsByIdempotencyKey(client, cleanKey);
    if (existing) {
      await client.query("COMMIT");
      return { ...existing, idempotentReplay: true };
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

    // 3. Insert order header
    const orderInsertRes = await client.query(
      `INSERT INTO public.orders (idempotency_key, status, total_amount, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [cleanKey, status, totalAmount.toFixed(2), actorId],
    );
    const createdOrder = orderInsertRes.rows[0];

    // 4. Log initial order creation in audit history
    await client.query(
      `INSERT INTO public.order_status_history
         (order_id, from_status, to_status, changed_by, reason)
       VALUES ($1, NULL, $2, $3, $4)`,
      [createdOrder.id, status, actorId, "Order punched"],
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
     LEFT JOIN public.order_items oi ON oi.order_id = o.id
     GROUP BY o.id
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

module.exports = {
  createOrder,
  getOrderWithItemsByIdempotencyKey,
  listOrders,
  transitionOrderStatus,
};
