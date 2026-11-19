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

// 1. Define the rate limiter FIRST
const aiBurstLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    if (
      req.xhr ||
      req.headers.accept?.includes("application/json") ||
      req.path !== "/items/chatbot"
    ) {
      return res.status(429).json({
        error:
          "Rate limit exceeded (max 5 AI requests per minute). Please wait 60 seconds.",
      });
    }
    return res
      .status(429)
      .send("Too many AI requests (max 5/minute). Please wait 60 seconds.");
  },
});

const aiSustainedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    if (
      req.xhr ||
      req.headers.accept?.includes("application/json") ||
      req.path !== "/items/chatbot"
    ) {
      return res.status(429).json({
        error:
          "15-minute AI quota reached (max 30 requests). Please try again later.",
      });
    }
    return res
      .status(429)
      .send("15-minute AI quota reached. Please try again later.");
  },
});

const aiProtection = [aiBurstLimiter, aiSustainedLimiter];

// 2. Register the limiters BEFORE mounting itemRouter!
app.post("/items/chatbot", aiProtection);
app.post("/items/scan-image", aiProtection);
app.post("/items/generate-description", aiProtection);
app.post("/items/suggest-category", aiProtection);

// // 3. Now mount your routers AFTER the limiters
// app.use("/items", itemRouter);
// app.use("/categories", categoryRouter);

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
