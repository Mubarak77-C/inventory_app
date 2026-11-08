// routes/itemRouter.js
const { Router } = require("express");
const itemController = require("../controllers/itemController");

const router = Router();

// GET /items/ -> Fetch all items
router.get("/", itemController.getItemsList);

// POST /items/ -> Create a new item
router.post("/", itemController.createItem);

module.exports = router;
