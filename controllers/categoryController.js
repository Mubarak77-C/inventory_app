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
    // 2.1: Check BEFORE querying PostgreSQL so non-numeric IDs (like /categories/abc/items) don't crash DB
    if (isNaN(Number(id))) {
      return res.status(400).render("404", {
        title: "Invalid Category ID",
        heading: "Invalid Category ID",
        message: "The category ID in the URL must be a valid number.",
      });
    }

    const category = await categoryModel.getCategoryById(id);

    // 2.2: Replace your old `res.status(404).send("Category not found.")` right here
    if (!category) {
      return res.status(404).render("404", {
        title: "Category Not Found",
        heading: "Category Not Found",
        message: `Category #${id} does not exist or may have been removed.`,
      });
    }

    const targetCategory = categories.find((cat) => cat.id === parseInt(id));

    if (!targetCategory) {
      return res.status(404).send("Category not found.");
    }

    const items = await itemModel.getItemsByCategory(id);

    const totalInventoryValue = items.reduce((sum, item) => {
      return sum + Number(item.price) * Number(item.stock_count || 0);
    }, 0);

    const allCategories = await categoryModel.getAllCategories();

    res.render("index", {
      items,
      totalInventoryValue,
      title: `${targetCategory.name} Inventory`, // <-- Passed dynamically here
      categories: allCategories,
      selectedCategory: req.params.id,
      searchTerm: "",
      maxPrice: "",
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
