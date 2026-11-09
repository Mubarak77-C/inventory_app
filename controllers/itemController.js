// controllers/itemController.js
const itemModel = require("../models/itemModel");
const categoryModel = require("../models/categoryModel");

async function getItemsList(req, res) {
  try {
    const items = await itemModel.getAllItems();
    res.render("index", { items });
  } catch (err) {
    console.error("Error in itemController (GET):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function renderNewItemForm(req, res) {
  try {
    const categories = await categoryModel.getAllCategories();
    res.render("newItem", { categories });
  } catch (err) {
    console.error("Error in itemController (renderNewItemForm):", err);
    res.status(500).send("Internal Server Error");
  }
}

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
    res.redirect("/items");
  } catch (err) {
    console.error("Error in itemController (POST):", err);
    res.status(500).send("Internal Server Error");
  }
}

// NEW: Render Edit Form with item data and categories
async function renderEditItemForm(req, res) {
  try {
    const { id } = req.params;
    const item = await itemModel.getItemById(id); // Make sure your model has this method
    const categories = await categoryModel.getAllCategories();

    if (!item) {
      return res.status(404).send("Item not found.");
    }

    res.render("editItem", { item, categories });
  } catch (err) {
    console.error("Error in itemController (renderEditItemForm):", err);
    res.status(500).send("Internal Server Error");
  }
}

// UPDATED: Handle update and redirect
async function updateItem(req, res) {
  try {
    const { id } = req.params;
    const { name, description, category_id, price, stock_count } = req.body;

    if (!name || !category_id || !price) {
      return res.status(400).send("Missing required fields.");
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

// UPDATED: Handle delete and redirect
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

module.exports = {
  getItemsList,
  renderNewItemForm,
  createItem,
  renderEditItemForm, // <-- Export new form renderer
  updateItem,
  deleteItem,
};
