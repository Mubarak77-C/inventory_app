// controllers/categoryController.js
const categoryModel = require("../models/categoryModel");
const itemModel = require("../models/itemModel"); // <-- Import item model

// Render the categories management page
async function renderCategoriesPage(req, res) {
  try {
    const categories = await categoryModel.getAllCategories();
    res.render("categories", { categories });
  } catch (err) {
    console.error("Error in categoryController (renderCategoriesPage):", err);
    res.status(500).send("Internal Server Error");
  }
}

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

// Handle form submission to create a category and redirect
async function createCategory(req, res) {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).send("Category name is required.");
    }

    await categoryModel.insertCategory(name, description || null);
    res.redirect("/categories");
  } catch (err) {
    console.error("Error in categoryController (createCategory):", err);
    if (err.code === "23505") {
      return res.status(400).send("Category name already exists.");
    }
    res.status(500).send("Internal Server Error");
  }
}

// New controller function to fetch items by category ID
async function getCategoryItems(req, res) {
  try {
    const { id } = req.params; // Grabs the category ID from the URL parameter

    // Optional: Fetch category details first to ensure it exists
    const categories = await categoryModel.getAllCategories();
    const targetCategory = categories.find((cat) => cat.id === parseInt(id));

    if (!targetCategory) {
      return res
        .status(404)
        .json({ success: false, error: "Category not found." });
    }

    const items = await itemModel.getItemsByCategory(id);

    // Render the index view, passing the filtered items and category name
    res.render("index", {
      items,
      title: `${targetCategory.name} Inventory`,
    });
  } catch (err) {
    console.error("Error in categoryController (getCategoryItems):", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
}

// Add this function to controllers/categoryController.js
async function deleteCategory(req, res) {
  try {
    const { id } = req.params;
    await categoryModel.deleteCategory(id);
    res.redirect("/categories");
  } catch (err) {
    console.error("Error in categoryController (DELETE):", err);
    res.status(500).send("Internal Server Error");
  }
}

// Make sure to export deleteCategory in module.exports
module.exports = {
  renderCategoriesPage,
  createCategory,
  getCategoryItems,
  deleteCategory, // <-- Export delete controller
};
