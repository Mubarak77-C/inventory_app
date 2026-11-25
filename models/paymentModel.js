// models/paymentModel.js
const pool = require("../db/pool");
const { createGatewayPaymentAttempt } = require("../services/paymentGateway");

const ALLOWED_ATTEMPT_METHODS = new Set(["CASH", "CARD", "UPI"]);

function createHttpError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function buildAttemptIdempotencyKey(orderId, attemptNumber, customKey) {
  if (customKey && String(customKey).trim().length > 0) {
    return String(customKey).trim().slice(0, 128);
  }
  return `order-${orderId}-attempt-${attemptNumber}`;
}

/**
 * Step 1 (Short TX): Validate order eligibility and create or return an idempotent payment attempt.
 */
async function preparePaymentAttempt({
  orderId,
  paymentMethod,
  currency = "INR",
  idempotencyKey = null,
}) {
  const numericOrderId = Number(orderId);
  if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
    throw createHttpError(
      400,
      "INVALID_ORDER_ID",
      "Order ID must be a positive integer.",
    );
  }

  const normalizedMethod = String(paymentMethod || "").toUpperCase();
  if (!ALLOWED_ATTEMPT_METHODS.has(normalizedMethod)) {
    throw createHttpError(
      400,
      "INVALID_PAYMENT_METHOD",
      "Payment method must be CASH, CARD, or UPI.",
    );
  }

  const normalizedCurrency = String(currency || "INR").toUpperCase();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orderRes = await client.query(
      `SELECT id, status, total_amount, payment_status
       FROM public.orders
       WHERE id = $1
       FOR UPDATE`,
      [numericOrderId],
    );

    if (orderRes.rows.length === 0) {
      throw createHttpError(
        404,
        "ORDER_NOT_FOUND",
        `Order #${numericOrderId} was not found.`,
      );
    }

    const order = orderRes.rows[0];

    if (order.status === "CANCELLED") {
      throw createHttpError(
        409,
        "ORDER_CANCELLED",
        "Cannot initiate a payment attempt for a CANCELLED order.",
      );
    }

    if (order.payment_status === "PAID") {
      throw createHttpError(
        409,
        "ORDER_ALREADY_PAID",
        `Order #${numericOrderId} is already marked PAID.`,
      );
    }

    const effectiveKey = buildAttemptIdempotencyKey(
      numericOrderId,
      1,
      idempotencyKey,
    );

    // If caller supplied an idempotency key that already exists, replay that attempt safely
    if (idempotencyKey && String(idempotencyKey).trim().length > 0) {
      const existingByKey = await client.query(
        `SELECT *
         FROM public.payment_attempts
         WHERE idempotency_key = $1`,
        [effectiveKey],
      );
      if (existingByKey.rows.length > 0) {
        await client.query("COMMIT");
        return {
          order,
          attempt: existingByKey.rows[0],
          replayed: true,
        };
      }
    }

    const countRes = await client.query(
      `SELECT COUNT(*)::int AS attempt_count
       FROM public.payment_attempts
       WHERE order_id = $1`,
      [numericOrderId],
    );
    const nextAttemptNumber = (countRes.rows[0]?.attempt_count || 0) + 1;
    const finalIdempotencyKey =
      idempotencyKey && String(idempotencyKey).trim().length > 0
        ? effectiveKey
        : buildAttemptIdempotencyKey(numericOrderId, nextAttemptNumber, null);

    const insertRes = await client.query(
      `INSERT INTO public.payment_attempts (
         order_id,
         idempotency_key,
         provider,
         payment_method,
         amount,
         currency,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'REQUIRES_ACTION')
       RETURNING *`,
      [
        numericOrderId,
        finalIdempotencyKey,
        process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
          ? "stripe_test"
          : "local_test_gateway",
        normalizedMethod,
        order.total_amount,
        normalizedCurrency,
      ],
    );

    await client.query("COMMIT");

    return {
      order,
      attempt: insertRes.rows[0],
      replayed: false,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // Ignore rollback error if transaction already aborted
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Step 3 (Short TX): Persist gateway response/outcome (SUCCEEDED or FAILED) on the attempt row.
 * Failed/declined attempts keep the order unpaid so the customer can retry.
 */
async function finalizePaymentAttempt({
  attemptId,
  provider,
  providerPaymentId,
  status,
  failureCode = null,
  failureMessage = null,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updatedRes = await client.query(
      `UPDATE public.payment_attempts
       SET provider = COALESCE($2, provider),
           provider_payment_id = COALESCE($3, provider_payment_id),
           status = $4,
           failure_code = $5,
           failure_message = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        attemptId,
        provider || null,
        providerPaymentId || null,
        status,
        failureCode,
        failureMessage,
      ],
    );

    await client.query("COMMIT");
    return updatedRes.rows[0] || null;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // Ignore rollback error
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Orchestrates Slice C1 payment intent creation:
 * 1) Short TX to prepare/lock attempt
 * 2) External gateway call outside DB lock
 * 3) Short TX to record gateway outcome
 */
async function initiateOrderPaymentAttempt({
  orderId,
  paymentMethod,
  currency = "INR",
  idempotencyKey = null,
  simulateOutcome = null,
}) {
  const prepared = await preparePaymentAttempt({
    orderId,
    paymentMethod,
    currency,
    idempotencyKey,
  });

  if (prepared.replayed && prepared.attempt.provider_payment_id) {
    return {
      order: prepared.order,
      attempt: prepared.attempt,
      replayed: true,
    };
  }

  const gatewayResult = await createGatewayPaymentAttempt({
    orderId: prepared.order.id,
    attemptId: prepared.attempt.id,
    idempotencyKey: prepared.attempt.idempotency_key,
    paymentMethod: prepared.attempt.payment_method,
    amount: prepared.attempt.amount,
    currency: prepared.attempt.currency,
    simulateOutcome,
  });

  const finalizedAttempt = await finalizePaymentAttempt({
    attemptId: prepared.attempt.id,
    provider: gatewayResult.provider,
    providerPaymentId: gatewayResult.providerPaymentId,
    status: gatewayResult.status,
    failureCode: gatewayResult.failureCode,
    failureMessage: gatewayResult.failureMessage,
  });

  return {
    order: prepared.order,
    attempt: finalizedAttempt,
    replayed: false,
  };
}

class ReconciliationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function reconcileMisappliedPayment({
  attemptId,
  wrongOrderId,
  rightOrderId,
  reason = "",
}) {
  const parsedAttemptId = Number(attemptId);
  const parsedWrongOrderId = Number(wrongOrderId);
  const parsedRightOrderId = Number(rightOrderId);

  if (!parsedAttemptId || !parsedWrongOrderId || !parsedRightOrderId) {
    throw new ReconciliationError(
      "INVALID_INPUT",
      "attemptId, wrongOrderId, and rightOrderId are required integers.",
    );
  }
  if (parsedWrongOrderId === parsedRightOrderId) {
    throw new ReconciliationError(
      "SAME_ORDER",
      "wrongOrderId and rightOrderId must be different.",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Lock the payment attempt row
    const attemptRes = await client.query(
      `SELECT id, order_id, idempotency_key, provider, provider_payment_id,
              payment_method, amount, currency, status
       FROM public.payment_attempts
       WHERE id = $1
       FOR UPDATE`,
      [parsedAttemptId],
    );

    if (attemptRes.rows.length === 0) {
      throw new ReconciliationError(
        "ATTEMPT_NOT_FOUND",
        `Payment attempt #${parsedAttemptId} not found.`,
        404,
      );
    }

    const attempt = attemptRes.rows[0];
    if (Number(attempt.order_id) !== parsedWrongOrderId) {
      throw new ReconciliationError(
        "ATTEMPT_ORDER_MISMATCH",
        `Attempt #${parsedAttemptId} belongs to order #${attempt.order_id}, not #${parsedWrongOrderId}.`,
      );
    }
    if (attempt.status !== "SUCCEEDED") {
      throw new ReconciliationError(
        "ATTEMPT_NOT_SUCCEEDED",
        `Only SUCCEEDED attempts can be reconciled (current status: ${attempt.status}).`,
      );
    }

    // 2. Lock both orders in deterministic ID order to avoid deadlocks
    const lowId = Math.min(parsedWrongOrderId, parsedRightOrderId);
    const highId = Math.max(parsedWrongOrderId, parsedRightOrderId);

    const ordersRes = await client.query(
      `SELECT id, status, total_amount, payment_status, payment_method, payment_reference, paid_at
       FROM public.orders
       WHERE id IN ($1, $2)
       ORDER BY id ASC
       FOR UPDATE`,
      [lowId, highId],
    );

    const wrongOrder = ordersRes.rows.find(
      (o) => Number(o.id) === parsedWrongOrderId,
    );
    const rightOrder = ordersRes.rows.find(
      (o) => Number(o.id) === parsedRightOrderId,
    );

    if (!wrongOrder) {
      throw new ReconciliationError(
        "WRONG_ORDER_NOT_FOUND",
        `Source order #${parsedWrongOrderId} not found.`,
        404,
      );
    }
    if (!rightOrder) {
      throw new ReconciliationError(
        "RIGHT_ORDER_NOT_FOUND",
        `Target order #${parsedRightOrderId} not found.`,
        404,
      );
    }
    if (rightOrder.status === "CANCELLED") {
      throw new ReconciliationError(
        "TARGET_ORDER_CANCELLED",
        `Cannot apply payment to cancelled order #${parsedRightOrderId}.`,
      );
    }
    if (rightOrder.payment_status === "PAID") {
      throw new ReconciliationError(
        "TARGET_ALREADY_PAID",
        `Target order #${parsedRightOrderId} is already PAID.`,
      );
    }
    if (Number(attempt.amount) !== Number(rightOrder.total_amount)) {
      throw new ReconciliationError(
        "AMOUNT_MISMATCH",
        `Attempt amount ($${Number(attempt.amount).toFixed(2)}) does not match target order #${parsedRightOrderId} total ($${Number(rightOrder.total_amount).toFixed(2)}).`,
      );
    }

    // 3. Mark the misapplied attempt as FAILED with audit trail
    const auditNote = reason
      ? `Reassigned from order #${parsedWrongOrderId} to #${parsedRightOrderId}: ${reason}`
      : `Reassigned from order #${parsedWrongOrderId} to #${parsedRightOrderId}`;

    await client.query(
      `UPDATE public.payment_attempts
       SET status = 'FAILED',
           failure_code = 'reassigned_wrong_order',
           failure_message = $2
       WHERE id = $1`,
      [parsedAttemptId, auditNote],
    );

    // 4. Revert the wrong order to UNPAID (satisfies chk_orders_paid_consistency)
    const updatedWrongRes = await client.query(
      `UPDATE public.orders
       SET payment_status = 'UNPAID',
           payment_method = NULL,
           payment_reference = NULL,
           paid_at = NULL
       WHERE id = $1
       RETURNING id, status, payment_status, payment_method, payment_reference, paid_at`,
      [parsedWrongOrderId],
    );

    // 5. Insert a reconciled SUCCEEDED payment attempt on the intended order
    const reconcileKey = `reconcile-attempt-${parsedAttemptId}-to-order-${parsedRightOrderId}`;
    const reconcileProviderRef = `${attempt.provider_payment_id}_reconciled`;

    const newAttemptRes = await client.query(
      `INSERT INTO public.payment_attempts (
         order_id, idempotency_key, provider, provider_payment_id,
         payment_method, amount, currency, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'SUCCEEDED')
       RETURNING id, order_id, provider_payment_id, payment_method, amount, currency, status, created_at`,
      [
        parsedRightOrderId,
        reconcileKey,
        attempt.provider,
        reconcileProviderRef,
        attempt.payment_method,
        attempt.amount,
        attempt.currency,
      ],
    );

    // 6. Settle the intended order as PAID
    const settledAt = wrongOrder.paid_at || new Date();
    const updatedRightRes = await client.query(
      `UPDATE public.orders
       SET payment_status = 'PAID',
           payment_method = $2,
           payment_reference = $3,
           paid_at = $4
       WHERE id = $1
       RETURNING id, status, payment_status, payment_method, payment_reference, paid_at`,
      [
        parsedRightOrderId,
        attempt.payment_method,
        attempt.provider_payment_id,
        settledAt,
      ],
    );

    await client.query("COMMIT");

    return {
      reconciledAttempt: newAttemptRes.rows[0],
      wrongOrder: updatedWrongRes.rows[0],
      rightOrder: updatedRightRes.rows[0],
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  preparePaymentAttempt,
  finalizePaymentAttempt,
  initiateOrderPaymentAttempt,
  reconcileMisappliedPayment,
  ReconciliationError,
};
