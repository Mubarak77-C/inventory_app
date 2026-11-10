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

module.exports = { generateItemDescription };
