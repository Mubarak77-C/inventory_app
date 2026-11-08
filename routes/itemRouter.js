// routes/itemRouter.js
const { Router } = require("express");
const itemController = require("../controllers/itemController");

const router = Router();

// GET /items/ -> Fetch all items
router.get("/", itemController.getItemsList);

// POST /items/ -> Create an item
router.post("/", itemController.createItem);

// PUT /items/:id -> Update an item by ID
router.put("/:id", itemController.updateItem);

// DELETE /items/:id -> Delete an item by ID
router.delete("/:id", itemController.deleteItem);

module.exports = router;
