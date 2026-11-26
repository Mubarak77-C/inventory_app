// routes/customerRouter.js
const express = require("express");
const router = express.Router();
const { requireRole } = require("../middleware/authMiddleware");
const {
  getCustomers,
  postCustomer,
} = require("../controllers/customerController");

router.get("/", requireRole("admin", "cashier"), getCustomers);
router.post("/", requireRole("admin", "cashier"), postCustomer);

module.exports = router;
