// models/itemModel.js
const pool = require("../db/pool");

async function getAllItems() {
  const query = `
    SELECT items.*, categories.name AS category_name 
    FROM items 
    LEFT JOIN categories ON items.category_id = categories.id;
  `;
  const { rows } = await pool.query(query);
  return rows;
}

// New function to insert an item into the database
async function insertItem(name, description, category_id, price, stock_count) {
  const query = `
    INSERT INTO items (name, description, category_id, price, stock_count)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const values = [name, description, category_id, price, stock_count];
  const { rows } = await pool.query(query, values);
  return rows[0]; // Return the newly created row
}

// models/itemModel.js (add this function to your existing exports)
async function getItemsByCategory(categoryId) {
  const query = `
    SELECT items.*, categories.name AS category_name 
    FROM items 
    LEFT JOIN categories ON items.category_id = categories.id
    WHERE items.category_id = $1;
  `;
  const { rows } = await pool.query(query, [categoryId]);
  return rows; // Returns an array of items belonging to this category
}

// models/itemModel.js (add to existing functions and exports)

async function updateItem(
  id,
  name,
  description,
  category_id,
  price,
  stock_count,
) {
  const query = `
    UPDATE items 
    SET name = $1, description = $2, category_id = $3, price = $4, stock_count = $5
    WHERE id = $6
    RETURNING *;
  `;
  const values = [name, description, category_id, price, stock_count, id];
  const { rows } = await pool.query(query, values);
  return rows[0]; // Returns undefined if ID doesn't exist
}
// Replace your current getItemById with this:
async function getItemById(id) {
  const query = `
    SELECT items.*, categories.name AS category_name 
    FROM items 
    LEFT JOIN categories ON items.category_id = categories.id
    WHERE items.id = $1;
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0]; // Return the single item object
}

async function deleteItem(id) {
  const query = "DELETE FROM items WHERE id = $1 RETURNING *;";
  const { rows } = await pool.query(query, [id]);
  return rows[0]; // Returns undefined if ID doesn't exist
}

module.exports = {
  getAllItems,
  insertItem,
  getItemsByCategory,
  updateItem, // <-- Export update
  deleteItem, // <-- Export delete
  getItemById,
};
