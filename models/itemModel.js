// models/itemModel.js
const pool = require("../db/pool");

// models/itemModel.js
async function getAllItems(searchTerm = "") {
  let query = `
    SELECT items.*, categories.name AS category_name 
    FROM items 
    LEFT JOIN categories ON items.category_id = categories.id
  `;
  let params = [];

  if (searchTerm.trim() !== "") {
    query += ` WHERE items.name ILIKE $1`;
    params.push(`%${searchTerm}%`);
  }

  query += ` ORDER BY items.id DESC;`;

  const { rows } = await pool.query(query, params);
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

// models/itemModel.js

// Fetch paginated items (with optional search filtering)
async function getPaginatedItems(searchTerm = "", limit = 10, offset = 0) {
  let query = `
    SELECT items.*, categories.name AS category_name 
    FROM items 
    LEFT JOIN categories ON items.category_id = categories.id
  `;
  let params = [];

  if (searchTerm.trim() !== "") {
    query += ` WHERE items.name ILIKE $1`;
    query += ` ORDER BY items.id DESC LIMIT $2 OFFSET $3;`;
    params = [`%${searchTerm}%`, limit, offset];
  } else {
    query += ` ORDER BY items.id DESC LIMIT $1 OFFSET $2;`;
    params = [limit, offset];
  }

  const { rows } = await pool.query(query, params);
  return rows;
}

// Count total items (for calculating total pages)
async function getTotalItemCount(searchTerm = "") {
  let query = `SELECT COUNT(*) FROM items`;
  let params = [];

  if (searchTerm.trim() !== "") {
    query += ` WHERE name ILIKE $1`;
    params.push(`%${searchTerm}%`);
  }

  const { rows } = await pool.query(query, params);
  return parseInt(rows[0].count, 10);
}

// Add these functions to models/itemModel.js

async function saveChatMessage(userMessage, aiResponse, snapshotData) {
  const query = `
    INSERT INTO chat_history (user_question, ai_response, snapshot_data) 
    VALUES ($1, $2, $3)
  `;
  await pool.query(query, [
    userMessage,
    aiResponse,
    JSON.stringify(snapshotData),
  ]);
}

async function getChatHistory(limit = 20) {
  const query = `
    SELECT * FROM chat_history 
    ORDER BY created_at ASC 
    LIMIT $1;
  `;
  const { rows } = await pool.query(query, [limit]);
  return rows;
}

async function clearChatHistory() {
  const query = `DELETE FROM chat_history;`;
  await pool.query(query);
}

module.exports = {
  getAllItems,
  insertItem,
  getItemsByCategory,
  updateItem, // <-- Export update
  deleteItem, // <-- Export delete
  getItemById,
  getPaginatedItems,
  getTotalItemCount,
  saveChatMessage,
  getChatHistory,
  clearChatHistory,
};
