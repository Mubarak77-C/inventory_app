// db/pool.js
const { Pool } = require("pg");
require("dotenv").config();

// Reads the DATABASE_URL from your .env file
module.exports = new Pool({
  connectionString: process.env.DATABASE_URL,
  // If you are hosting remotely later (like Render/Supabase),
  // you may need ssl: { rejectUnauthorized: false }
});
