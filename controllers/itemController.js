// controllers/itemController.js
const itemModel = require("../models/itemModel");

async function getItemsList(req, res) {
  try {
    const items = await itemModel.getAllItems();
    res.status(200).json({
      success: true,
      count: items.length,
      items: items,
    });
  } catch (err) {
    console.error("Error in itemController (GET):", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
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

module.exports = {
  getItemsList,
  createItem,
};
