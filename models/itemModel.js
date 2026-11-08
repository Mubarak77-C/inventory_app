// models/itemModel.js
const pool = require("../db/pool");

async function getAllItems() {
  const { rows } = await pool.query("SELECT * FROM items");
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

module.exports = {
  getAllItems,
  insertItem,
};
