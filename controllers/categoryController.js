// controllers/categoryController.js
const categoryModel = require("../models/categoryModel");
const itemModel = require("../models/itemModel");

async function renderCategoriesPage(req, res) {
  try {
    const categories = await categoryModel.getAllCategories();
    res.render("categories", {
      categories,
      title: "Category Management", // <-- Passed here
    });
  } catch (err) {
    console.error("Error in categoryController (renderCategoriesPage):", err);
    res.status(500).send("Internal Server Error");
  }
}

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

async function getCategoryItems(req, res) {
  try {
    const { id } = req.params;
    const categories = await categoryModel.getAllCategories();
    const targetCategory = categories.find((cat) => cat.id === parseInt(id));

    if (!targetCategory) {
      return res.status(404).send("Category not found.");
    }

    const items = await itemModel.getItemsByCategory(id);

    const totalInventoryValue = items.reduce((sum, item) => {
      return sum + Number(item.price) * Number(item.stock_count || 0);
    }, 0);

    res.render("index", {
      items,
      totalInventoryValue,
      title: `${targetCategory.name} Inventory`, // <-- Passed dynamically here
    });
  } catch (err) {
    console.error("Error in categoryController (getCategoryItems):", err);
    res.status(500).send("Internal Server Error");
  }
}

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

module.exports = {
  renderCategoriesPage,
  createCategory,
  getCategoryItems,
  deleteCategory,
};
