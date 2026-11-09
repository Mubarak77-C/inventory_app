// routes/categoryRouter.js
const { Router } = require("express");
const categoryController = require("../controllers/categoryController");

const router = Router();

// GET /categories/ -> Render category management dashboard & form
router.get("/", categoryController.renderCategoriesPage);

// POST /categories/ -> Handle new category creation
router.post("/", categoryController.createCategory);

// GET /categories/:id/items -> Fetch items belonging to a specific category ID
router.get("/:id/items", categoryController.getCategoryItems);

// DELETE /categories/:id -> Handle category deletion
router.delete("/:id", categoryController.deleteCategory);

module.exports = router;
