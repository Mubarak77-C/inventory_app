// models/categoryModel.js
const pool = require("../db/pool");

async function getAllCategories() {
  const { rows } = await pool.query("SELECT * FROM categories");
  return rows;
}

async function insertCategory(name, description) {
  const query = `
    INSERT INTO categories (name, description)
    VALUES ($1, $2)
    RETURNING *;
  `;
  const values = [name, description];
  const { rows } = await pool.query(query, values);
  return rows[0];
}

// Add this function to models/categoryModel.js
async function deleteCategory(id) {
  const query = "DELETE FROM categories WHERE id = $1 RETURNING *;";
  const { rows } = await pool.query(query, [id]);
  return rows[0]; // Returns undefined if ID doesn't exist
}

// Don't forget to export it!
module.exports = {
  getAllCategories,
  insertCategory,
  deleteCategory, // <-- Export delete
};
