// controllers/itemController.js
const itemModel = require("../models/itemModel");
const categoryModel = require("../models/categoryModel");

async function getItemsList(req, res) {
  try {
    const items = await itemModel.getAllItems();

    const totalInventoryValue = items.reduce((sum, item) => {
      return sum + Number(item.price) * Number(item.stock_count || 0);
    }, 0);

    res.render("index", {
      items,
      totalInventoryValue,
      title: "Inventory Dashboard", // <-- Passed here
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

module.exports = {
  getItemsList,
  renderNewItemForm,
  createItem,
  renderEditItemForm,
  updateItem,
  deleteItem,
};
