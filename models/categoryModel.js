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

module.exports = {
  getAllCategories,
  insertCategory,
};
