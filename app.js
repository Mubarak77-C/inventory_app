// app.js
const express = require("express");
const path = require("path");
const pool = require("./db/pool");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true })); // Parses form data (req.body)
app.use(express.json()); // Parses JSON payloads

// Simple test route to verify DB connection and server flow
app.get("/", async (req, res) => {
  try {
    // Run a quick query to test PostgreSQL connection
    const result = await pool.query("SELECT NOW()");
    res
      .status(200)
      .send(`Server is running successfully! DB Time: ${result.rows[0].now}`);
  } catch (err) {
    console.error("Database connection error:", err);
    res.status(500).send("Database connection failed. Check your .env file.");
  }
});

// Start server listener
app.listen(PORT, () => {
  console.log(`Inventory app listening on http://localhost:${PORT}`);
});
