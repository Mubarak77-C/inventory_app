// routes/categoryRouter.js
const { Router } = require("express");
const categoryController = require("../controllers/categoryController");

const router = Router();

// GET /categories/ -> Fetch all categories
router.get("/", categoryController.getCategoriesList);

// POST /categories/ -> Create a new category
router.post("/", categoryController.createCategory);

module.exports = router;
