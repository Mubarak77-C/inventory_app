// services/geminiService.js
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI();

async function generateItemDescription(itemName, categoryName, retries = 3) {
  const prompt = `Write a short, professional, and catchy inventory description (under 30 words) for an item named "${itemName}" in the category "${categoryName}". Do not include quotes or extra fluff.`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
      });

      return response.text.trim();
    } catch (err) {
      console.warn(
        `Attempt ${attempt} failed (Status ${err.status || 503}). Retrying in ${attempt * 1000}ms...`,
      );

      if (attempt === retries) {
        console.error(
          "Error generating Gemini description after max retries:",
          err,
        );
        return null;
      }

      // Wait before trying again (Exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

// Add this function to services/geminiService.js
async function suggestCategory(itemName, categories) {
  try {
    // Format categories for the prompt so Gemini knows the valid options
    const categoryList = categories
      .map((c) => `ID: ${c.id}, Name: ${c.name}`)
      .join("\n");

    const prompt = `You are an inventory management assistant. 
Based on the item name "${itemName}", choose the best matching category ID from the list below.
Return ONLY the category ID as a plain number (e.g. 3). If none match well, return the ID of the most logical general category.

Categories:
${categoryList}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
    });

    const categoryId = parseInt(response.text.trim(), 10);
    return isNaN(categoryId) ? null : categoryId;
  } catch (err) {
    console.error("Error suggesting category:", err);
    return null;
  }
}

// Add this function to services/geminiService.js
// services/geminiService.js

async function generateRestockAdvice(lowStockItems, retries = 3) {
  const itemList = lowStockItems
    .map(
      (item) =>
        `- ${item.name} (${item.category_name || "Uncategorized"}): Only ${item.stock_count} left in stock. Price: $${item.price}`,
    )
    .join("\n");

  const prompt = `You are an expert restaurant and inventory manager. 
Analyze the following low-stock or out-of-stock inventory items and write a concise executive restocking report. 
Provide actionable priorities (Urgent restock vs Moderate restock) and practical purchasing advice. Keep it professional, structured with markdown bullet points, and under 150 words.

Low-Stock Items:
${itemList}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
      });

      return response.text.trim();
    } catch (err) {
      console.warn(
        `Restock advice attempt ${attempt} failed (Status ${err.status || 503}). Retrying in ${attempt * 1000}ms...`,
      );

      if (attempt === retries) {
        console.error(
          "Error generating restock advice after max retries:",
          err,
        );
        return "Unable to generate AI restock advice due to high demand. Please refresh the page in a few moments.";
      }

      // Wait before trying again (Exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

// Add this function to services/geminiService.js
async function askInventoryAssistant(userQuestion, allItems, categories) {
  try {
    // Format inventory items into text context for Gemini (including ID and timestamp)
    const inventoryContext = allItems
      .map(
        (item) =>
          `ID: ${item.id}, Name: ${item.name}, Category: ${item.category_name || "Uncategorized"}, Price: $${item.price}, Stock: ${item.stock_count}, Added At: ${item.created_at || "Unknown"}, Description: ${item.description || "None"}`,
      )
      .join("\n");

    const categoryContext = categories.map((c) => c.name).join(", ");

    const prompt = `You are an expert AI Inventory & Restaurant Manager Assistant. 
You have access to the current database records below (ordered newest to oldest by ID and Added At timestamp). Answer the user's question clearly, professionally, and concisely based ONLY on this data. If you don't know or the item isn't listed, state that politely.

Available Categories: ${categoryContext}

Current Inventory Records:
${inventoryContext}

User Question: "${userQuestion}"`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
    });

    return response.text.trim();
  } catch (err) {
    console.error("Error in AI chatbot assistant:", err);
    return "Sorry, I am having trouble connecting to the inventory assistant right now.";
  }
}

async function extractItemFromImage(imageBuffer, mimeType) {
  try {
    // Convert image buffer to the inline format expected by @google/genai
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString("base64"),
        mimeType: mimeType,
      },
    };

    const prompt = `Analyze this image (which may be a product, receipt, or invoice) and extract inventory details for a new item.
Return ONLY a valid JSON object with these exact keys (no markdown code blocks, just raw JSON):
{
  "name": "Extracted item name",
  "description": "Short catchy description under 25 words",
  "price": 0.00,
  "stock_count": 1
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: [imagePart, prompt],
    });

    let textResponse = response.text.trim();
    // Clean up potential markdown formatting if Gemini includes backticks
    textResponse = textResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(textResponse);
  } catch (err) {
    console.error("Error extracting item from image:", err);
    return null;
  }
}

// Don't forget to export extractItemFromImage along with your other functions
module.exports = {
  generateItemDescription,
  suggestCategory,
  generateRestockAdvice,
  askInventoryAssistant,
  extractItemFromImage,
};
