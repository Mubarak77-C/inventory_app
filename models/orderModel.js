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

  return Array.from(aggregated.entries()).map(([itemId, quantity]) => ({
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

/**
 * Atomically creates an order, snapshots item name & price, and deducts items.stock_count.
 *
 * @param {Object} params
 * @param {string} params.idempotencyKey
 * @param {Array<{itemId?: number, item_id?: number, quantity: number}>} params.items
 * @param {number|null} [params.createdBy=null]
 * @param {string} [params.status="PENDING"]
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
      [cleanKey, status, totalAmount.toFixed(2), createdBy],
    );
    const createdOrder = orderInsertRes.rows[0];

    // 4. Insert order_items snapshot rows
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

    // Handle concurrent duplicate idempotency_key race cleanly
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

module.exports = {
  createOrder,
  getOrderWithItemsByIdempotencyKey,
};
