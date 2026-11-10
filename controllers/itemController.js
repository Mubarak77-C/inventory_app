// controllers/itemController.js
const itemModel = require("../models/itemModel");
const categoryModel = require("../models/categoryModel");
const { generateRestockAdvice } = require("../services/geminiService");
const { askInventoryAssistant } = require("../services/geminiService");
const { extractItemFromImage } = require("../services/geminiService");
const { generateInventoryPDF } = require("../services/pdfService");

// controllers/itemController.js
async function getItemsList(req, res) {
  try {
    const searchTerm = req.query.search || "";
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    // 1. Fetch paginated items for the table
    const items = await itemModel.getPaginatedItems(searchTerm, limit, offset);
    const totalItems = await itemModel.getTotalItemCount(searchTerm);
    const totalPages = Math.ceil(totalItems / limit) || 1;

    // 2. Fetch ALL items & categories for calculating executive metrics and charts
    const allItems = await itemModel.getAllItems();
    const categories = await categoryModel.getAllCategories();

    // 3. Calculate total inventory asset value
    const totalInventoryValue = allItems.reduce((sum, item) => {
      return sum + Number(item.price) * Number(item.stock_count || 0);
    }, 0);

    // 4. Calculate category breakdown for Chart.js
    const categoryData = categories.map((cat) => {
      const catItems = allItems.filter((i) => i.category_id === cat.id);
      const stockSum = catItems.reduce(
        (acc, i) => acc + Number(i.stock_count || 0),
        0,
      );
      const valueSum = catItems.reduce(
        (acc, i) => acc + Number(i.price) * Number(i.stock_count || 0),
        0,
      );
      return {
        name: cat.name,
        count: catItems.length,
        stock: stockSum,
        value: valueSum,
      };
    });

    // 5. Render index view with all required analytics data
    res.render("index", {
      items,
      totalInventoryValue,
      searchTerm,
      currentPage: page,
      totalPages,
      title: "Inventory Dashboard",
      categoryData, // <-- Passed to view for Chart.js
    });
  } catch (err) {
    console.error("Error in itemController (getItemsList):", err);
    res.status(500).send("Internal Server Error");
  }
}
async function renderNewItemForm(req, res) {
  try {
    const categories = await categoryModel.getAllCategories();
    res.render("newItem", {
      categories,
      title: "Add New Item", // <-- Passed here
    });
  } catch (err) {
    console.error("Error in itemController (renderNewItemForm):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function createItem(req, res) {
  try {
    const { name, description, category_id, price, stock_count } = req.body;

    if (!name || !category_id || price === undefined) {
      return res.status(400).send("Missing required fields.");
    }

    if (Number(price) < 0) {
      return res.status(400).send("Price cannot be negative.");
    }

    await itemModel.insertItem(
      name,
      description || null,
      category_id,
      price,
      stock_count || 0,
    );
    res.redirect("/items");
  } catch (err) {
    console.error("Error in itemController (POST):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function renderEditItemForm(req, res) {
  try {
    const { id } = req.params;
    const item = await itemModel.getItemById(id);
    const categories = await categoryModel.getAllCategories();

    if (!item) {
      return res.status(404).send("Item not found.");
    }

    res.render("editItem", {
      item,
      categories,
      title: "Edit Item", // <-- Passed here
    });
  } catch (err) {
    console.error("Error in itemController (renderEditItemForm):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function updateItem(req, res) {
  try {
    const { id } = req.params;
    const { name, description, category_id, price, stock_count } = req.body;

    if (!name || !category_id || price === undefined) {
      return res.status(400).send("Missing required fields.");
    }

    if (Number(price) < 0) {
      return res.status(400).send("Price cannot be negative.");
    }

    await itemModel.updateItem(
      id,
      name,
      description || null,
      category_id,
      price,
      stock_count || 0,
    );

    res.redirect("/items");
  } catch (err) {
    console.error("Error in itemController (PUT):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function deleteItem(req, res) {
  try {
    const { id } = req.params;
    await itemModel.deleteItem(id);
    res.redirect("/items");
  } catch (err) {
    console.error("Error in itemController (DELETE):", err);
    res.status(500).send("Internal Server Error");
  }
}

async function getRestockAdvisorReport(req, res) {
  try {
    // Fetch items where stock is 5 or less
    const allItems = await itemModel.getAllItems();
    const lowStockItems = allItems.filter(
      (item) => Number(item.stock_count) <= 5,
    );

    if (lowStockItems.length === 0) {
      return res.render("restockAdvisor", {
        title: "AI Restock Advisor",
        report:
          "🎉 Great news! All inventory items are currently at healthy stock levels. No restock needed.",
        lowStockItems: [],
      });
    }

    const report = await generateRestockAdvice(lowStockItems);

    res.render("restockAdvisor", {
      title: "AI Restock Advisor",
      report,
      lowStockItems,
    });
  } catch (err) {
    console.error("Error in restock advisor controller:", err);
    res.status(500).send("Internal Server Error");
  }
}

// Handle chat submissions
async function handleChatQuery(req, res) {
  try {
    const { question } = req.body;
    if (!question) {
      return res.render("chatbot", {
        title: "AI Inventory Assistant",
        answer: "Please ask a question about your inventory.",
        question: "",
      });
    }

    // Fetch live inventory and categories from database to give Gemini context
    const allItems = await itemModel.getAllItems();
    const categories = await categoryModel.getAllCategories();

    const answer = await askInventoryAssistant(question, allItems, categories);

    res.render("chatbot", {
      title: "AI Inventory Assistant",
      answer,
      question,
    });
  } catch (err) {
    console.error("Error handling chat query:", err);
    res.status(500).send("Internal Server Error");
  }
}

// tracking chatbot and render save to table history_chat
// Render the chatbot UI page
async function renderChatbotPage(req, res) {
  try {
    const history = await itemModel.getChatHistory(30); // Load last 30 messages
    res.render("chatbot", {
      title: "AI Inventory Assistant",
      history,
    });
  } catch (err) {
    console.error("Error rendering chatbot page:", err);
    res.status(500).send("Internal Server Error");
  }
}

async function handleChatQuery(req, res) {
  try {
    const { question } = req.body;
    if (!question || !question.trim()) {
      return res.redirect("/items/chatbot");
    }

    // 1. Fetch current items & categories for snapshot context
    const allItems = await itemModel.getAllItems();
    const categories = await categoryModel.getAllCategories();

    // 2. Ask Gemini with current context
    const answer = await askInventoryAssistant(question, allItems, categories);

    // 3. Save to database with a snapshot of the inventory state at this exact timestamp
    const snapshotData = {
      itemCount: allItems.length,
      items: allItems.map((i) => ({
        name: i.name,
        stock: i.stock_count,
        price: i.price,
      })),
    };

    await itemModel.saveChatMessage(question, answer, snapshotData);

    res.redirect("/items/chatbot");
  } catch (err) {
    console.error("Error handling chat query:", err);
    res.status(500).send("Internal Server Error");
  }
}

async function clearChat(req, res) {
  try {
    await itemModel.clearChatHistory();
    res.redirect("/items/chatbot");
  } catch (err) {
    console.error("Error clearing chat history:", err);
    res.status(500).send("Internal Server Error");
  }
}

async function scanItemImage(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const extractedData = await extractItemFromImage(
      req.file.buffer,
      req.file.mimetype,
    );

    if (!extractedData) {
      return res
        .status(500)
        .json({ error: "Failed to parse image data with AI" });
    }

    res.json(extractedData);
  } catch (err) {
    console.error("Error in image scan route:", err);
    res.status(500).json({ error: "Internal server error during scan" });
  }
}

async function exportInventoryPDF(req, res) {
  try {
    const allItems = await itemModel.getAllItems();

    // Set headers so browser downloads it as a PDF attachment
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=inventory-report.pdf",
    );

    generateInventoryPDF(allItems, res);
  } catch (err) {
    console.error("Error generating inventory PDF:", err);
    res.status(500).send("Internal Server Error");
  }
}

// async function renderDashboard(req, res) {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = 10;
//     const search = req.query.search || "";

//     // Get paginated items and total count
//     const items = await itemModel.getItemsPaginated(page, limit, search);
//     const totalItemsCount = await itemModel.getTotalCount(search);
//     const totalPages = Math.ceil(totalItemsCount / limit);

//     // Fetch ALL items for calculating dashboard metrics & charts
//     const allItems = await itemModel.getAllItems();
//     const categories = await categoryModel.getAllCategories();

//     // Calculate total inventory value
//     const totalInventoryValue = allItems.reduce(
//       (acc, item) => acc + Number(item.price) * Number(item.stock_count),
//       0,
//     );

//     // Calculate category breakdown for Chart.js
//     const categoryData = categories.map((cat) => {
//       const catItems = allItems.filter((i) => i.category_id === cat.id);
//       const stockSum = catItems.reduce(
//         (acc, i) => acc + Number(i.stock_count),
//         0,
//       );
//       const valueSum = catItems.reduce(
//         (acc, i) => acc + Number(i.price) * Number(i.stock_count),
//         0,
//       );
//       return {
//         name: cat.name,
//         count: catItems.length,
//         stock: stockSum,
//         value: valueSum,
//       };
//     });

//     res.render("index", {
//       title: "Inventory Dashboard",
//       items,
//       currentPage: page,
//       totalPages,
//       searchTerm: search,
//       totalInventoryValue,
//       categoryData, // Pass analytics data to the view
//     });
//   } catch (err) {
//     console.error("Error rendering dashboard:", err);
//     res.status(500).send("Internal Server Error");
//   }
// }

module.exports = {
  getItemsList,
  renderNewItemForm,
  createItem,
  renderEditItemForm,
  updateItem,
  deleteItem,
  getRestockAdvisorReport,
  renderChatbotPage,
  handleChatQuery,
  clearChat,
  scanItemImage,
  exportInventoryPDF,
  // renderDashboard,
};
