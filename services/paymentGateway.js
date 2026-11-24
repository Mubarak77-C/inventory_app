// services/paymentGateway.js
const crypto = require("crypto");

function toSmallestUnit(amount, currency) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error("Invalid payment amount");
  }
  const zeroDecimalCurrencies = new Set(["JPY", "KRW"]);
  const upper = String(currency || "INR").toUpperCase();
  return zeroDecimalCurrencies.has(upper)
    ? Math.round(num)
    : Math.round(num * 100);
}

/**
 * Initiates a gateway payment attempt outside any open DB transaction.
 * Supports Stripe test mode (when STRIPE_SECRET_KEY starts with sk_test_)
 * or a deterministic local test simulator for offline practice.
 */
async function createGatewayPaymentAttempt({
  orderId,
  attemptId,
  idempotencyKey,
  paymentMethod,
  amount,
  currency = "INR",
  simulateOutcome = null,
}) {
  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  const normalizedCurrency = String(currency || "INR").toLowerCase();
  const unitAmount = toSmallestUnit(amount, currency);

  if (stripeKey.startsWith("sk_test_")) {
    const params = new URLSearchParams();
    params.append("amount", String(unitAmount));
    params.append("currency", normalizedCurrency);
    params.append("metadata[order_id]", String(orderId));
    params.append("metadata[attempt_id]", String(attemptId));
    params.append("metadata[pos_payment_method]", String(paymentMethod));

    // In Stripe test mode, card PaymentIntents can attach a test payment method if requested
    if (paymentMethod === "CARD") {
      const testPm =
        simulateOutcome === "DECLINE"
          ? "pm_card_chargeDeclined"
          : "pm_card_visa";
      params.append("payment_method", testPm);
      params.append("payment_method_types[]", "card");
      params.append("confirm", "true");
    }

    const res = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      const errObj = data?.error || {};
      return {
        provider: "stripe_test",
        providerPaymentId: errObj.payment_intent?.id || null,
        status: "FAILED",
        failureCode: errObj.code || errObj.type || "GATEWAY_ERROR",
        failureMessage: errObj.message || "Gateway rejected payment intent",
      };
    }

    const mappedStatus =
      data.status === "succeeded"
        ? "SUCCEEDED"
        : data.status === "processing"
          ? "PROCESSING"
          : "REQUIRES_ACTION";

    return {
      provider: "stripe_test",
      providerPaymentId: data.id,
      status: mappedStatus,
      failureCode: null,
      failureMessage: null,
    };
  }

  // Local test simulator when STRIPE_SECRET_KEY is not configured
  const mockId =
    "pi_test_" +
    crypto
      .createHash("sha256")
      .update(idempotencyKey)
      .digest("hex")
      .slice(0, 20);

  if (simulateOutcome === "DECLINE") {
    return {
      provider: "local_test_gateway",
      providerPaymentId: mockId,
      status: "FAILED",
      failureCode: "card_declined",
      failureMessage:
        "Simulated test card decline (insufficient funds or issuer decline)",
    };
  }

  return {
    provider: "local_test_gateway",
    providerPaymentId: mockId,
    status: "SUCCEEDED",
    failureCode: null,
    failureMessage: null,
  };
}

module.exports = {
  createGatewayPaymentAttempt,
  toSmallestUnit,
};
