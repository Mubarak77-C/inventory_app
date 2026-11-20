// routes/categoryRouter.js
const { Router } = require("express");
const categoryController = require("../controllers/categoryController");
const { requireAdmin } = require("../middleware/authMiddleware");

const router = Router();

// Public read routes
router.get("/", categoryController.renderCategoriesPage);
router.get("/:id/items", categoryController.getCategoryItems);

// Protected admin write routes
router.post("/", requireAdmin, categoryController.createCategory);
router.delete("/:id", requireAdmin, categoryController.deleteCategory);

module.exports = router;
