// routes/itemRouter.js
const { Router } = require("express");
const itemController = require("../controllers/itemController");
// const { generateItemDescription } = require("../services/geminiService");
const {
  generateItemDescription,
  suggestCategory,
} = require("../services/geminiService");
const categoryModel = require("../models/categoryModel");
const router = Router();

// Add this import at the top of routes/itemRouter.js if not already present
// (itemController already imports itemModel)

// Add this route ABOVE your dynamic /:id routes
router.get("/restock-advisor", itemController.getRestockAdvisorReport);

router.get("/chatbot", itemController.renderChatbotPage);
router.post("/chatbot", itemController.handleChatQuery);

// Add this route inside routes/itemRouter.js (above dynamic /:id routes)
router.post("/generate-description", async (req, res) => {
  try {
    const { name, categoryName } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Item name is required" });
    }

    const description = await generateItemDescription(
      name,
      categoryName || "General",
    );

    if (!description) {
      return res
        .status(500)
        .json({ error: "Gemini returned an empty response." });
    }

    res.json({ description });
  } catch (err) {
    // THIS LINE WILL PRINT THE FULL ERROR IN YOUR BROWSER ALERT & TERMINAL
    console.error("Detailed Error in AI generation route:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to generate description" });
  }
});

router.post("/suggest-category", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Item name is required" });
    }

    // Fetch existing categories from DB
    const categories = await categoryModel.getAllCategories();
    if (!categories || categories.length === 0) {
      return res.status(400).json({ error: "No categories available" });
    }

    const suggestedId = await suggestCategory(name, categories);
    res.json({ categoryId: suggestedId });
  } catch (err) {
    console.error("Error in category suggestion route:", err);
    res.status(500).json({ error: "Failed to suggest category" });
  }
});

// GET /items/new -> Render the creation form
router.get("/new", itemController.renderNewItemForm);

// GET /items/:id/edit -> Render the edit form
router.get("/:id/edit", itemController.renderEditItemForm);

// GET /items/ -> Fetch all items & render dashboard
router.get("/", itemController.getItemsList);

// POST /items/ -> Handle form submission
router.post("/", itemController.createItem);

// PUT and DELETE routes (handled via method-override)
router.put("/:id", itemController.updateItem);
router.delete("/:id", itemController.deleteItem);

module.exports = router;
