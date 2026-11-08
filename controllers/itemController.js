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
    console.error("Error in itemController:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
}

module.exports = {
  getItemsList,
};
