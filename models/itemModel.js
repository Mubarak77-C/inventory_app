// models/itemModel.js
const pool = require("../db/pool");

// Function to fetch all items from the database
async function getAllItems() {
  const { rows } = await pool.query("SELECT * FROM items");
  return rows;
}

module.exports = {
  getAllItems,
};
