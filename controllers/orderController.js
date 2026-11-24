// controllers/orderController.js

const {
  createOrder,
  listOrders,
  transitionOrderStatus,
  editOrderItems,
} = require("../models/orderModel");
const { initiateOrderPaymentAttempt } = require("../models/paymentModel");
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
    const createdBy =
      req.session?.userId ?? req.session?.user?.id ?? req.user?.id ?? null;

    const result = await createOrder({
      idempotencyKey,
      items,
      createdBy,
      status,
      paymentMethod: req.body?.paymentMethod ?? req.body?.payment_method,
      paymentReference:
        req.body?.paymentReference ?? req.body?.payment_reference,
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
    const reason = req.body?.reason;
    const changedBy =
      req.session?.userId ?? req.session?.user?.id ?? req.user?.id ?? null;

    const result = await transitionOrderStatus({
      orderId: id,
      nextStatus,
      changedBy,
      reason: req.body?.reason,
      paymentMethod: req.body?.paymentMethod ?? req.body?.payment_method,
      paymentReference:
        req.body?.paymentReference ?? req.body?.payment_reference,
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

async function editOrder(req, res, next) {
  try {
    const { id } = req.params;
    const items = req.body?.items;
    const reason = req.body?.reason;
    const changedBy =
      req.session?.userId ?? req.session?.user?.id ?? req.user?.id ?? null;

    const result = await editOrderItems({
      orderId: id,
      items,
      changedBy,
      reason,
    });

    return res.status(200).json({
      order: result.order,
      items: result.items,
      stockChanges: result.stockChanges,
    });
  } catch (err) {
    if (err.statusCode) {
      const payload = {
        error: err.message,
        code: err.code || "ORDER_EDIT_ERROR",
      };

      if (err.orderId !== undefined) payload.orderId = err.orderId;
      if (err.currentStatus !== undefined)
        payload.currentStatus = err.currentStatus;
      if (err.itemId !== undefined) payload.itemId = err.itemId;
      if (err.available !== undefined) payload.available = err.available;

      return res.status(err.statusCode).json(payload);
    }

    return next(err);
  }
}

async function createPaymentIntent(req, res) {
  try {
    const orderId = Number(req.params.id);
    const { paymentMethod, currency, idempotencyKey, simulateOutcome } =
      req.body || {};

    const headerIdempotencyKey = req.get("Idempotency-Key");
    const effectiveKey = idempotencyKey || headerIdempotencyKey || null;

    // Only allow simulateOutcome in non-production environments for local/sandbox testing
    const safeSimulateOutcome =
      process.env.NODE_ENV !== "production" &&
      (simulateOutcome === "APPROVE" || simulateOutcome === "DECLINE")
        ? simulateOutcome
        : null;

    const result = await initiateOrderPaymentAttempt({
      orderId,
      paymentMethod,
      currency: currency || "INR",
      idempotencyKey: effectiveKey,
      simulateOutcome: safeSimulateOutcome,
    });

    const httpStatus = result.replayed ? 200 : 201;
    return res.status(httpStatus).json({
      replayed: result.replayed,
      order: result.order,
      paymentAttempt: result.attempt,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        code: err.code || "PAYMENT_ATTEMPT_ERROR",
        error: err.message,
      });
    }

    console.error("Error creating payment intent:", err);
    return res.status(500).json({
      code: "INTERNAL_SERVER_ERROR",
      error: "Failed to initiate payment attempt.",
    });
  }
}
module.exports = {
  punchOrder,
  getOrders,
  transitionOrderStatus,
  updateOrderStatus,
  editOrder,
  createPaymentIntent,
};
