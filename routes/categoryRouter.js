// routes/categoryRouter.js
const { Router } = require("express");
const categoryController = require("../controllers/categoryController");

const router = Router();
const { requireAdmin } = require("../middleware/authMiddleware");

// Public read routes
router.get("/", itemController.getAllItems);
router.get("/:id", itemController.getItemById);

// Protected admin write routes
router.get("/new", requireAdmin, itemController.getCreateItemForm);
router.post("/new", requireAdmin, itemController.createItem);
router.get("/:id/edit", requireAdmin, itemController.getEditItemForm);
router.post("/:id/edit", requireAdmin, itemController.updateItem);
router.post("/:id/delete", requireAdmin, itemController.deleteItem);

// GET /categories/ -> Render category management dashboard & form
router.get("/", categoryController.renderCategoriesPage);

// POST /categories/ -> Handle new category creation
router.post("/", categoryController.createCategory);

// GET /categories/:id/items -> Fetch items belonging to a specific category ID
router.get("/:id/items", categoryController.getCategoryItems);

// DELETE /categories/:id -> Handle category deletion
router.delete("/:id", categoryController.deleteCategory);

module.exports = router;
