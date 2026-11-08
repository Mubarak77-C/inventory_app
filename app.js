// app.js
const express = require("express");
const path = require("path");
require("dotenv").config();

const itemRouter = require("./routes/itemRouter");
const categoryRouter = require("./routes/categoryRouter");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Mount Routers
// Any request starting with /items will go to itemRouter
app.use("/items", itemRouter);
app.use("/categories", categoryRouter);
// Root route fallback
app.get("/", (req, res) => {
  res.send(
    'Welcome to the Inventory API! Go to <a href="/items">/items</a> to see all items.',
  );
});

// Start server listener
app.listen(PORT, () => {
  console.log(`Inventory app listening on http://localhost:${PORT}`);
});
