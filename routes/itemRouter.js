// routes/itemRouter.js
const { Router } = require("express");
const itemController = require("../controllers/itemController");

const router = Router();

// GET /items/new -> Render the form (MUST be above /:id)
router.get("/new", itemController.renderNewItemForm);

// GET /items/ -> Fetch all items & render dashboard
router.get("/", itemController.getItemsList);

// POST /items/ -> Handle form submission
router.post("/", itemController.createItem);

// PUT and DELETE routes...
router.put("/:id", itemController.updateItem);
router.delete("/:id", itemController.deleteItem);

module.exports = router;
