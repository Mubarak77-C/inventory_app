const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const authController = require("../controllers/authController");

const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 login attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render("login", {
      title: "Admin Login",
      error: "Too many login attempts. Please wait 15 minutes and try again.",
    });
  },
});

authRouter.post("/login", loginLimiter, authController.postLogin);

authRouter.get("/login", authController.getLoginForm);
authRouter.post("/login", authController.postLogin);
authRouter.post("/logout", authController.postLogout);

module.exports = authRouter;
