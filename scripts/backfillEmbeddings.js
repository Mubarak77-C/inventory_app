require("dotenv").config();
const pool = require("../db/pool");
const { generateEmbedding } = require("../services/geminiService");

async function backfillEmbeddings() {
  console.log("🔍 Checking for items missing embeddings...");

  try {
    const { rows } = await pool.query(
      "SELECT id, name, description FROM items WHERE embedding IS NULL ORDER BY id ASC",
    );

    if (rows.length === 0) {
      console.log("✅ All items already have embeddings. Nothing to backfill!");
      return;
    }

    console.log(`📦 Found ${rows.length} item(s) to embed...\n`);

    let successCount = 0;
    let failCount = 0;

    for (const item of rows) {
      const textToEmbed = `${item.name} - ${item.description || ""}`.trim();
      const embedding = await generateEmbedding(textToEmbed);

      if (embedding && Array.isArray(embedding)) {
        await pool.query(
          "UPDATE items SET embedding = $1::vector WHERE id = $2",
          [JSON.stringify(embedding), item.id],
        );
        console.log(`  ✔ [${item.id}] Embedded: ${item.name}`);
        successCount++;
      } else {
        console.warn(
          `  ✖ [${item.id}] Failed to generate embedding: ${item.name}`,
        );
        failCount++;
      }

      // Small 200ms pause to respect Gemini API rate limits on large batches
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(
      `\n🎉 Backfill complete! Success: ${successCount}, Failed: ${failCount}`,
    );
  } catch (err) {
    console.error("❌ Error during embedding backfill:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

backfillEmbeddings();
