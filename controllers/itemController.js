// controllers/itemController.js
const itemModel = require("../models/itemModel");
const categoryModel = require("../models/categoryModel");
const {
  generateRestockAdvice,
  askInventoryAssistant,
  extractItemFromImage,
  generateEmbedding,
} = require("../services/geminiService");

const { generateInventoryPDF } = require("../services/pdfService");

async function getItemsList(req, res) {
  try {
    const searchTerm = req.query.search || "";
    const selectedCategory = req.query.category || "";
    const maxPrice = req.query.maxPrice || "";
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    let items = [];
    let totalItems = 0;
    let totalPages = 1;

    if (searchTerm.trim() !== "") {
      const queryEmbedding = await generateEmbedding(searchTerm);
      if (queryEmbedding) {
        items = await itemModel.semanticSearchItems(
          queryEmbedding,
          searchTerm,
          selectedCategory,
          maxPrice,
        );
        totalItems = items.length;
        totalPages = 1;
      } else {
        items = await itemModel.getFilteredItems(
          searchTerm,
          selectedCategory,
          maxPrice,
          limit,
          offset,
        );
        totalItems = await itemModel.getFilteredItemCount(
          searchTerm,
          selectedCategory,
          maxPrice,
        );
        totalPages = Math.ceil(totalItems / limit) || 1;
      }
    } else {
      items = await itemModel.getFilteredItems(
        "",
        selectedCategory,
        maxPrice,
        limit,
        offset,
      );
      totalItems = await itemModel.getFilteredItemCount(
        "",
        selectedCategory,
        maxPrice,
      );
      totalPages = Math.ceil(totalItems / limit) || 1;
    }

    const allItems = await itemModel.getAllItems();
    const categories = await categoryModel.getAllCategories();

    const totalInventoryValue = allItems.reduce((sum, item) => {
      return sum + Number(item.price) * Number(item.stock_count || 0);
    }, 0);

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

    res.render("index", {
      items,
      categories,
      selectedCategory,
      maxPrice,
      totalInventoryValue,
      searchTerm,
      currentPage: page,
      totalPages,
      title: "Inventory Dashboard",
      categoryData,
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
    //semanctic search embedded
    const textToEmbed = `${name} - ${description || ""}`;
    const embedding = await generateEmbedding(textToEmbed);

    await itemModel.insertItem(
      name,
      description || null,
      category_id,
      price,
      stock_count || 0,
      embedding,
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
    const [item, categories, similarItems] = await Promise.all([
      itemModel.getItemById(id),
      categoryModel.getAllCategories(),
      itemModel.getSimilarItems(id, 3),
    ]);

    if (!item) {
      return res.status(404).render("404", {
        title: "Item Not Found",
        heading: "Item Not Found",
        message: `Item #${id} does not exist.`,
      });
    }

    res.render("editItem", {
      item,
      categories,
      similarItems,
      title: "Edit Item",
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

    const textToEmbed = `${name} - ${description || ""}`;
    const embedding = await generateEmbedding(textToEmbed);

    await itemModel.updateItem(
      id,
      name,
      description || null,
      category_id,
      price,
      stock_count || 0,
      embedding,
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

    const cleanQuestion = question.trim();

    // 1. Embed the user's question & fetch categories + summary stats in parallel
    const [questionEmbedding, categories, summaryStats] = await Promise.all([
      generateEmbedding(cleanQuestion),
      categoryModel.getAllCategories(),
      itemModel.getInventorySummary(),
    ]);

    // 2. Vector RAG Retrieval: fetch ONLY semantically relevant items via pgvector
    let relevantItems = [];
    if (questionEmbedding) {
      relevantItems = await itemModel.semanticSearchItems(
        questionEmbedding,
        cleanQuestion,
      );
    }

    // Fallback: if question is broad (e.g., "give me an overview") and vector search
    // returns 0 items above the 0.57 threshold, load top 10 items so Gemini has context
    if (relevantItems.length === 0) {
      relevantItems = await itemModel.getFilteredItems("", "", "", 10, 0);
    }

    // 3. Ask Gemini with ONLY the retrieved relevant items (keeps Array format compatible!)
    const answer = await askInventoryAssistant(
      cleanQuestion,
      relevantItems,
      categories,
    );

    // 4. Save to database with a snapshot matching your original schema + summary stats
    const snapshotData = {
      itemCount: summaryStats.total_unique_items,
      retrievedCount: relevantItems.length,
      totalInventoryValue: summaryStats.total_inventory_value,
      items: relevantItems.map((i) => ({
        name: i.name,
        stock: i.stock_count,
        price: i.price,
        added_at: i.created_at,
      })),
    };

    await itemModel.saveChatMessage(cleanQuestion, answer, snapshotData);

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
