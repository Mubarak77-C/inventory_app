// controllers/itemController.js
const itemModel = require("../models/itemModel");
const categoryModel = require("../models/categoryModel");

async function getItemsList(req, res) {
  try {
    const items = await itemModel.getAllItems();

    // Render the 'index.ejs' file and pass the items array into it
    res.render("index", { items });
  } catch (err) {
    console.error("Error in itemController (GET):", err);
    res.status(500).send("Internal Server Error");
  }
}

// New controller function to handle item creation
async function createItem(req, res) {
  try {
    const { name, description, category_id, price, stock_count } = req.body;

    // Basic validation
    if (!name || !category_id || !price) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: name, category_id, and price are required.",
      });
    }

    // Call model to insert data
    const newItem = await itemModel.insertItem(
      name,
      description || null,
      category_id,
      price,
      stock_count || 0,
    );

    res.status(201).json({
      success: true,
      message: "Item created successfully!",
      item: newItem,
    });
  } catch (err) {
    console.error("Error in itemController (POST):", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
}

// controllers/itemController.js (add to existing functions and exports)

async function updateItem(req, res) {
  try {
    const { id } = req.params;
    const { name, description, category_id, price, stock_count } = req.body;

    if (!name || !category_id || !price) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: name, category_id, and price are required.",
      });
    }

    const updatedItem = await itemModel.updateItem(
      id,
      name,
      description || null,
      category_id,
      price,
      stock_count || 0,
    );

    if (!updatedItem) {
      return res.status(404).json({ success: false, error: "Item not found." });
    }

    res.status(200).json({
      success: true,
      message: "Item updated successfully!",
      item: updatedItem,
    });
  } catch (err) {
    console.error("Error in itemController (PUT):", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
}

async function deleteItem(req, res) {
  try {
    const { id } = req.params;
    const deletedItem = await itemModel.deleteItem(id);

    if (!deletedItem) {
      return res.status(404).json({ success: false, error: "Item not found." });
    }

    res.status(200).json({
      success: true,
      message: "Item deleted successfully!",
      item: deletedItem,
    });
  } catch (err) {
    console.error("Error in itemController (DELETE):", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
}

// controllers/itemController.js (add renderNewItemForm and update createItem)

// Render the HTML form view
async function renderNewItemForm(req, res) {
  res.render("newItem");
}

// Update createItem to redirect after insertion
async function createItem(req, res) {
  try {
    const { name, description, category_id, price, stock_count } = req.body;

    if (!name || !category_id || !price) {
      return res.status(400).send("Missing required fields.");
    }

    await itemModel.insertItem(
      name,
      description || null,
      category_id,
      price,
      stock_count || 0,
    );
    // Redirect user back to the main inventory dashboard
    res.redirect("/items");
  } catch (err) {
    console.error("Error in itemController (POST):", err);
    res.status(500).send("Internal Server Error");
  }
}

// Fetch categories and pass them to the EJS form view
async function renderNewItemForm(req, res) {
  try {
    const categories = await categoryModel.getAllCategories();
    res.render("newItem", { categories }); // Pass categories array to view
  } catch (err) {
    console.error("Error in itemController (renderNewItemForm):", err);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  getItemsList,
  renderNewItemForm, // <-- Export form renderer
  createItem,
  updateItem,
  deleteItem,
};
