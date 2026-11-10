// controllers/itemController.js
const itemModel = require("../models/itemModel");
const categoryModel = require("../models/categoryModel");
const { generateRestockAdvice } = require("../services/geminiService");

// controllers/itemController.js
async function getItemsList(req, res) {
  try {
    const searchTerm = req.query.search || "";
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const items = await itemModel.getPaginatedItems(searchTerm, limit, offset);
    const totalItems = await itemModel.getTotalItemCount(searchTerm);
    const totalPages = Math.ceil(totalItems / limit) || 1;

    // --- ADD THESE DEBUG LOGS ---
    console.log("--- DEBUG PAGINATION ---");
    console.log("Total Items in DB:", totalItems);
    console.log("Total Pages calculated:", totalPages);
    console.log("Current Page:", page);
    console.log("Items fetched for this page:", items.length);
    // ----------------------------

    const allMatchingItems = await itemModel.getAllItems(searchTerm);
    const totalInventoryValue = allMatchingItems.reduce((sum, item) => {
      return sum + Number(item.price) * Number(item.stock_count || 0);
    }, 0);

    res.render("index", {
      items,
      totalInventoryValue,
      searchTerm,
      currentPage: page,
      totalPages,
      title: "Inventory Dashboard",
    });
  } catch (err) {
    console.error("Error in itemController (GET):", err);
    res.status(500).send("Internal Server Error");
  }
}
async function renderNewItemForm(req, res) {
  try {
    const categories = await categoryModel.getAllCategories();
    res.render("newItem", {
      categories,
      title: "Add New Item", // <-- Passed here
    });
  } catch (err) {
    console.error("Error in itemController (renderNewItemForm):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function createItem(req, res) {
  try {
    const { name, description, category_id, price, stock_count } = req.body;

    if (!name || !category_id || price === undefined) {
      return res.status(400).send("Missing required fields.");
    }

    if (Number(price) < 0) {
      return res.status(400).send("Price cannot be negative.");
    }

    await itemModel.insertItem(
      name,
      description || null,
      category_id,
      price,
      stock_count || 0,
    );
    res.redirect("/items");
  } catch (err) {
    console.error("Error in itemController (POST):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function renderEditItemForm(req, res) {
  try {
    const { id } = req.params;
    const item = await itemModel.getItemById(id);
    const categories = await categoryModel.getAllCategories();

    if (!item) {
      return res.status(404).send("Item not found.");
    }

    res.render("editItem", {
      item,
      categories,
      title: "Edit Item", // <-- Passed here
    });
  } catch (err) {
    console.error("Error in itemController (renderEditItemForm):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function updateItem(req, res) {
  try {
    const { id } = req.params;
    const { name, description, category_id, price, stock_count } = req.body;

    if (!name || !category_id || price === undefined) {
      return res.status(400).send("Missing required fields.");
    }

    if (Number(price) < 0) {
      return res.status(400).send("Price cannot be negative.");
    }

    await itemModel.updateItem(
      id,
      name,
      description || null,
      category_id,
      price,
      stock_count || 0,
    );

    res.redirect("/items");
  } catch (err) {
    console.error("Error in itemController (PUT):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function deleteItem(req, res) {
  try {
    const { id } = req.params;
    await itemModel.deleteItem(id);
    res.redirect("/items");
  } catch (err) {
    console.error("Error in itemController (DELETE):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function getRestockAdvisorReport(req, res) {
  try {
    // Fetch items where stock is 5 or less
    const allItems = await itemModel.getAllItems();
    const lowStockItems = allItems.filter(
      (item) => Number(item.stock_count) <= 5,
    );

    if (lowStockItems.length === 0) {
      return res.render("restockAdvisor", {
        title: "AI Restock Advisor",
        report:
          "🎉 Great news! All inventory items are currently at healthy stock levels. No restock needed.",
        lowStockItems: [],
      });
    }

    const report = await generateRestockAdvice(lowStockItems);

    res.render("restockAdvisor", {
      title: "AI Restock Advisor",
      report,
      lowStockItems,
    });
  } catch (err) {
    console.error("Error in restock advisor controller:", err);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  getItemsList,
  renderNewItemForm,
  createItem,
  renderEditItemForm,
  updateItem,
  deleteItem,
  getRestockAdvisorReport,
};
