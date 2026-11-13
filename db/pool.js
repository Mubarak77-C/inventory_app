// db/pool.js
const { Pool } = require("pg");
require("dotenv").config();

// Reads the DATABASE_URL from your environment (which Docker injects)
module.exports = new Pool({
  connectionString: process.env.DATABASE_URL,
  // If hosting remotely later (like Render/Supabase), you can add SSL config here if needed
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});
