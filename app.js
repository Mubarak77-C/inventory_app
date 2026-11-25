// app.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const methodOverride = require("method-override");
const helmet = require("helmet");
// const rateLimit = require("express-rate-limit");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const pool = require("./db/pool");
const { attachUserToLocals } = require("./middleware/authMiddleware");
const authRouter = require("./routes/authRouter");
const itemRouter = require("./routes/itemRouter");
const categoryRouter = require("./routes/categoryRouter");
const orderRouter = require("./routes/orderRouter");

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Security Headers & View Engine
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// 2. Body Parsers & Method Override (MUST come before session & routes)
app.use(express.urlencoded({ extended: true }));
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(methodOverride("_method"));

// 3. Session Store & User Locals (MUST come before all routers)
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session",
    }),
    secret: process.env.SESSION_SECRET || "dev_fallback_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8, // 8-hour shift session
    },
  }),
);
app.use(attachUserToLocals);

// 4. Two-Layer AI Rate Limiting (keyed by logged-in userId or IP)
const aiBurstLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.session?.userId ? `user_${req.session.userId}` : ipKeyGenerator(req.ip),
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
  keyGenerator: (req) =>
    req.session?.userId ? `user_${req.session.userId}` : ipKeyGenerator(req.ip),
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
app.post("/items/chatbot", aiProtection);
app.post("/items/scan-image", aiProtection);
app.post("/items/generate-description", aiProtection);
app.post("/items/suggest-category", aiProtection);

// 5. Application Routes
app.get("/", (req, res) => {
  res.redirect("/items");
});
app.use("/", authRouter);
app.use("/items", itemRouter);
app.use("/categories", categoryRouter);
app.use("/orders", orderRouter);

// 6. 404 Catch-All Handler (MUST always stay at the very bottom)
app.use((req, res) => {
  res.status(404).render("404", {
    title: "Page Not Found",
    heading: "Page Not Found",
    message: "We couldn't find the page you requested.",
  });
});

// Start server listener
app.listen(PORT, () => {
  console.log(`Inventory app listening on http://localhost:${PORT}`);
  console.log(
    "Webhook secret configured:",
    Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  );
});
