// controllers/orderController.js

const {
  createOrder,
  listOrders,
  transitionOrderStatus,
} = require("../models/orderModel");
const pool = require("../db/pool");

function extractIdempotencyKey(req) {
  return (
    req.get("Idempotency-Key") ||
    req.get("X-Idempotency-Key") ||
    req.body?.idempotencyKey ||
    req.body?.idempotency_key ||
    ""
  );
}

async function punchOrder(req, res, next) {
  try {
    const idempotencyKey = extractIdempotencyKey(req);
    const items = req.body?.items;
    const status = req.body?.status || "PENDING";
    const createdBy = req.session?.userId ?? null;

    const result = await createOrder({
      idempotencyKey,
      items,
      createdBy,
      status,
    });

    const httpStatus = result.idempotentReplay ? 200 : 201;

    return res.status(httpStatus).json({
      idempotentReplay: result.idempotentReplay,
      order: result.order,
      items: result.items,
    });
  } catch (err) {
    if (err.statusCode) {
      const payload = {
        error: err.message,
        code: err.code || "ORDER_ERROR",
      };

      if (err.itemId !== undefined) payload.itemId = err.itemId;
      if (err.requested !== undefined) payload.requested = err.requested;
      if (err.available !== undefined) payload.available = err.available;

      return res.status(err.statusCode).json(payload);
    }

    return next(err);
  }
}

async function getOrders(req, res, next) {
  try {
    const orders = await listOrders(req.query.limit);
    const wantsJson =
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes("application/json"));

    if (wantsJson) {
      return res.status(200).json({ orders });
    }

    const itemsRes = await pool.query(
      `SELECT id, name, price, stock_count
       FROM public.items
       ORDER BY name ASC, id ASC`,
    );

    return res.render("orders/index", {
      orders,
      catalogItems: itemsRes.rows,
      currentUserRole: req.session?.role || "",
    });
  } catch (err) {
    return next(err);
  }
}

async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const nextStatus = req.body?.status;

    const result = await transitionOrderStatus({
      orderId: id,
      nextStatus,
    });

    return res.status(200).json({
      order: result.order,
      items: result.items,
      restoredItems: result.restoredItems,
    });
  } catch (err) {
    if (err.statusCode) {
      const payload = {
        error: err.message,
        code: err.code || "ORDER_STATUS_ERROR",
      };

      if (err.orderId !== undefined) payload.orderId = err.orderId;
      if (err.currentStatus !== undefined)
        payload.currentStatus = err.currentStatus;
      if (err.attemptedStatus !== undefined) {
        payload.attemptedStatus = err.attemptedStatus;
      }

      return res.status(err.statusCode).json(payload);
    }

    return next(err);
  }
}
module.exports = {
  punchOrder,
  getOrders,
  transitionOrderStatus,
  updateOrderStatus,
};
