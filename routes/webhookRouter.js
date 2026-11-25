const { Router } = require("express");
const { processStripeWebhook } = require("../services/webhookService");

const router = Router();

router.post("/stripe", async (req, res) => {
  try {
    const signatureHeader =
      req.get("Stripe-Signature") || req.get("stripe-signature");
    const rawBody = req.rawBody || req.body;
    const payload =
      req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
        ? req.body
        : JSON.parse(
            Buffer.isBuffer(rawBody)
              ? rawBody.toString("utf8")
              : String(rawBody || "{}"),
          );

    const result = await processStripeWebhook({
      rawBody,
      signatureHeader,
      payload,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.status(result.status || 200).json({
      received: true,
      duplicate: Boolean(result.duplicate),
      eventId: result.eventId,
      orderId: result.orderId ?? null,
    });
  } catch (err) {
    console.error("Stripe webhook processing error:", err);
    return res.status(500).json({ error: "Failed to process webhook event." });
  }
});

module.exports = router;
