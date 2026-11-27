// controllers/orderController.js

const {
  createOrder,
  listOrders,
  transitionOrderStatus,
  editOrderItems,
} = require("../models/orderModel");
const {
  initiateOrderPaymentAttempt,
  reconcileMisappliedPayment,
  ReconciliationError,
} = require("../models/paymentModel");
const { listCustomers } = require("../models/customerModel");
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

async function getOrders(req, res, next) {
  try {
    const orders = await listOrders(req.query.limit);
    const wantsJson =
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes("application/json"));

    if (wantsJson) {
      return res.status(200).json({ orders });
    }

    const [itemsRes, customers] = await Promise.all([
      pool.query(
        `SELECT id, name, price, stock_count
         FROM public.items
         ORDER BY name ASC, id ASC`,
      ),
      listCustomers(),
    ]);

    return res.render("orders/index", {
      orders,
      catalogItems: itemsRes.rows,
      customers,
      currentUserRole: req.session?.role || "",
    });
  } catch (err) {
    return next(err);
  }
}

async function punchOrder(req, res, next) {
  try {
    const idempotencyKey = extractIdempotencyKey(req);
    const items = req.body?.items;
    const status = req.body?.status || "PENDING";
    const createdBy =
      req.session?.userId ?? req.session?.user?.id ?? req.user?.id ?? null;
    const customerId = req.body?.customerId ?? req.body?.customer_id ?? null;

    const result = await createOrder({
      idempotencyKey,
      items,
      createdBy,
      status,
      paymentMethod: req.body?.paymentMethod ?? req.body?.payment_method,
      paymentReference:
        req.body?.paymentReference ?? req.body?.payment_reference,
      customerId,
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

async function postReconcilePayment(req, res, next) {
  try {
    const { attemptId, wrongOrderId, rightOrderId, reason } = req.body || {};

    const result = await reconcileMisappliedPayment({
      attemptId,
      wrongOrderId,
      rightOrderId,
      reason: typeof reason === "string" ? reason.trim() : "",
    });

    return res.status(200).json({
      message: `Payment attempt #${attemptId} reconciled from order #${wrongOrderId} to order #${rightOrderId}.`,
      ...result,
    });
  } catch (err) {
    if (err instanceof ReconciliationError) {
      return res.status(err.statusCode).json({
        code: err.code,
        error: err.message,
      });
    }
    return next(err);
  }
}
async function getOrderInvoice(req, res, next) {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).send("Invalid order ID.");
    }

    const invoiceData = await getOrderInvoiceById(orderId);
    if (!invoiceData) {
      return res.status(404).send(`Order #${orderId} not found.`);
    }

    return res.render("orders/invoice", {
      order: invoiceData.order,
      items: invoiceData.items,
    });
  } catch (err) {
    return next(err);
  }
}
module.exports = {
  punchOrder,
  getOrders,
  transitionOrderStatus,
  updateOrderStatus,
  editOrder,
  createPaymentIntent,
  postReconcilePayment,
  getOrderInvoice,
};
