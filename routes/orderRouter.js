// routes/orderRouter.js
const { Router } = require("express");
const orderController = require("../controllers/orderController");
const { requireRole } = require("../middleware/authMiddleware");

const router = Router();

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
  requireAuth,
  requireRole("admin", "cashier"),
  orderController.createPaymentIntent,
);
module.exports = router;
