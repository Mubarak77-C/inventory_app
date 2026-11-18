// app.js
const express = require("express");
const path = require("path");
require("dotenv").config();

const itemRouter = require("./routes/itemRouter");
const categoryRouter = require("./routes/categoryRouter");
const methodOverride = require("method-override");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
// 1. Secure HTTP headers (allow inline scripts & Tailwind CDN for EJS views)
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

// 2. Rate limiter specifically for expensive Gemini AI endpoints
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 AI requests per 15 minutes
  message: "Too many AI requests from this IP. Please try again in 15 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/items/chatbot", aiLimiter);
app.use("/items/scan-image", aiLimiter);
app.use("/items/generate-description", aiLimiter);
app.use("/items/suggest-category", aiLimiter);

app.use(methodOverride("_method"));

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Mount Routers
// Any request starting with /items will go to itemRouter
app.use("/items", itemRouter);
app.use("/categories", categoryRouter);

app.use((req, res) => {
  res.status(404).render("404", {
    title: "Page Not Found",
    heading: "Page Not Found",
    message: "We couldn't find the page you requested.",
  });
});

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
