const { Router } = require("express");
const authController = require("../controllers/authController");

const authRouter = Router();

authRouter.get("/login", authController.getLoginForm);
authRouter.post("/login", authController.postLogin);
authRouter.post("/logout", authController.postLogout);

module.exports = authRouter;
