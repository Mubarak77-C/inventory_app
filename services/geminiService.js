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
module.exports = {
  generateItemDescription,
  suggestCategory,
  generateRestockAdvice,
};
