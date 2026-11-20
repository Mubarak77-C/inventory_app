// routes/itemRouter.js
const { Router } = require("express");
const itemController = require("../controllers/itemController");
const multer = require("multer");
const {
  generateItemDescription,
  suggestCategory,
} = require("../services/geminiService");
const categoryModel = require("../models/categoryModel");
const { requireAdmin } = require("../middleware/authMiddleware");

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public read & AI/report routes (must stay ABOVE any /:id routes)
router.get("/", itemController.getItemsList);
router.get("/chatbot", itemController.renderChatbotPage);
router.post("/chatbot", itemController.handleChatQuery);
router.post("/chatbot/clear", itemController.clearChat);
router.get("/restock-advisor", itemController.getRestockAdvisorReport);
router.get("/export-pdf", itemController.exportInventoryPDF);

router.post(
  "/scan-image",
  upload.single("itemImage"),
  itemController.scanItemImage,
);

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

// Protected Admin Write Routes
router.get("/new", requireAdmin, itemController.renderNewItemForm);
router.post("/", requireAdmin, itemController.createItem);
router.get("/:id/edit", requireAdmin, itemController.renderEditItemForm);
router.put("/:id", requireAdmin, itemController.updateItem);
router.delete("/:id", requireAdmin, itemController.deleteItem);

module.exports = router;
