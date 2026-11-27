// routes/orderRouter.js
const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { requireRole, requireAdmin } = require("../middleware/authMiddleware"); // adjust to your middleware names

// Punch / create an order (cashier, admin, and superadmin via requireRole)
router.get("/", requireRole("admin", "cashier"), orderController.getOrders);
router.post("/", requireRole("admin", "cashier"), orderController.punchOrder);

router.patch(
  "/:id/status",
  requireRole("admin", "cashier"),
  orderController.updateOrderStatus,
);

router.put(
  "/:id/items",
  requireRole("admin", "cashier"),
  orderController.editOrder,
);
router.post(
  "/:id/payment-intent",

  requireRole("admin", "cashier"),
  orderController.createPaymentIntent,
);

// Admin-only endpoint to reassign a misapplied payment between orders
router.post(
  "/reconcile-payment",
  requireAdmin,
  orderController.postReconcilePayment,
);

router.get(
  "/:id/invoice",
  requireRole("admin", "cashier"),
  orderController.getOrderInvoice,
);
module.exports = router;
