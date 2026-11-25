const crypto = require("crypto");
const pool = require("../db/pool");

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!rawBody || !signatureHeader || !secret) {
    return false;
  }

  const parts = String(signatureHeader)
    .split(",")
    .reduce((acc, item) => {
      const [key, val] = item.split("=");
      if (key && val) acc[key.trim()] = val.trim();
      return acc;
    }, {});

  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) {
    return false;
  }

  const payloadBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody), "utf8");

  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}.`, "utf8"),
    payloadBuffer,
  ]);

  const computedHex = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  const a = Buffer.from(computedHex, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

async function processStripeWebhook({ rawBody, signatureHeader, payload }) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const validSig = verifyStripeSignature(rawBody, signatureHeader, secret);
  if (!validSig) {
    return { ok: false, status: 400, error: "Invalid webhook signature." };
  }

  const eventId = payload?.id;
  const eventType = payload?.type;
  const dataObj = payload?.data?.object || {};
  const providerPaymentId = dataObj.id;
  const orderId = Number(dataObj.metadata?.order_id);

  if (!eventId || !eventType) {
    return {
      ok: false,
      status: 400,
      error: "Missing webhook event id or type.",
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertedEvent = await client.query(
      `INSERT INTO public.payment_webhook_events (event_id, provider, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, "stripe_test", eventType, JSON.stringify(payload)],
    );

    if (insertedEvent.rowCount === 0) {
      await client.query("COMMIT");
      return { ok: true, status: 200, duplicate: true, eventId };
    }

    let attempt = null;
    if (providerPaymentId) {
      const attemptRes = await client.query(
        `SELECT id, order_id, payment_method, status
         FROM public.payment_attempts
         WHERE provider_payment_id = $1
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [providerPaymentId],
      );
      attempt = attemptRes.rows[0] || null;
    }

    const targetOrderId = attempt ? Number(attempt.order_id) : orderId;

    if (eventType === "payment_intent.succeeded" && targetOrderId) {
      if (attempt) {
        await client.query(
          `UPDATE public.payment_attempts
           SET status = 'SUCCEEDED',
               failure_code = NULL,
               failure_message = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [attempt.id],
        );
      }

      await client.query(
        `UPDATE public.orders
         SET payment_status = 'PAID',
             payment_method = COALESCE(payment_method, $2, 'CARD'),
             payment_reference = COALESCE(payment_reference, $3),
             paid_at = COALESCE(paid_at, NOW())
         WHERE id = $1`,
        [
          targetOrderId,
          attempt?.payment_method || null,
          providerPaymentId || null,
        ],
      );
    } else if (eventType === "payment_intent.payment_failed" && attempt) {
      const errCode = dataObj.last_payment_error?.code || "card_declined";
      const errMsg =
        dataObj.last_payment_error?.message || "Payment failed via webhook";

      await client.query(
        `UPDATE public.payment_attempts
         SET status = 'FAILED',
             failure_code = $2,
             failure_message = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [attempt.id, errCode, errMsg],
      );
    }

    await client.query("COMMIT");
    return {
      ok: true,
      status: 200,
      duplicate: false,
      eventId,
      orderId: targetOrderId || null,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  verifyStripeSignature,
  processStripeWebhook,
};
