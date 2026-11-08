// routes/itemRouter.js
const { Router } = require("express");
const itemController = require("../controllers/itemController");

const router = Router();

// GET request to /items/ gets handled by getItemsList controller
router.get("/", itemController.getItemsList);

module.exports = router;
