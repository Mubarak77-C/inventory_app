// services/geminiService.js
const { GoogleGenAI } = require("@google/genai");

// Automatically picks up process.env.GEMINI_API_KEY
const ai = new GoogleGenAI();

async function generateItemDescription(itemName, categoryName) {
  try {
    const prompt = `Write a short, professional, and catchy inventory description (under 30 words) for an item named "${itemName}" in the category "${categoryName}". Do not include quotes or extra fluff.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return response.text.trim();
  } catch (err) {
    console.error("Error generating Gemini description:", err);
    return null;
  }
}

module.exports = { generateItemDescription };
