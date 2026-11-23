// routes/orderRouter.js
const { Router } = require("express");
const orderController = require("../controllers/orderController");
const { requireRole } = require("../middleware/authMiddleware");

const router = Router();

// Punch / create an order (cashier, admin, and superadmin via requireRole)
router.post("/", requireRole("admin", "cashier"), orderController.punchOrder);

module.exports = router;
