// controllers/categoryController.js
const categoryModel = require("../models/categoryModel");

async function getCategoriesList(req, res) {
  try {
    const categories = await categoryModel.getAllCategories();
    res.status(200).json({
      success: true,
      count: categories.length,
      categories: categories,
    });
  } catch (err) {
    console.error("Error in categoryController (GET):", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
}

async function createCategory(req, res) {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: category name is required.",
      });
    }

    const newCategory = await categoryModel.insertCategory(
      name,
      description || null,
    );

    res.status(201).json({
      success: true,
      message: "Category created successfully!",
      category: newCategory,
    });
  } catch (err) {
    console.error("Error in categoryController (POST):", err);

    // PostgreSQL unique constraint error code for duplicate names
    if (err.code === "23505") {
      return res
        .status(400)
        .json({ success: false, error: "Category name already exists." });
    }

    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
}

module.exports = {
  getCategoriesList,
  createCategory,
};
