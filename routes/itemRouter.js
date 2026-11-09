// routes/itemRouter.js
const { Router } = require("express");
const itemController = require("../controllers/itemController");

const router = Router();

// GET /items/new -> Render the creation form
router.get("/new", itemController.renderNewItemForm);

// GET /items/:id/edit -> Render the edit form
router.get("/:id/edit", itemController.renderEditItemForm);

// GET /items/ -> Fetch all items & render dashboard
router.get("/", itemController.getItemsList);

// POST /items/ -> Handle form submission
router.post("/", itemController.createItem);

// PUT and DELETE routes (handled via method-override)
router.put("/:id", itemController.updateItem);
router.delete("/:id", itemController.deleteItem);

module.exports = router;
