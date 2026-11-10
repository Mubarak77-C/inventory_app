// services/pdfService.js
const PDFDocument = require("pdfkit");

function generateInventoryPDF(allItems, res) {
  // Create a new PDF document
  const doc = new PDFDocument({ margin: 50, size: "A4" });

  // Pipe the PDF directly to the HTTP response stream
  doc.pipe(res);

  // --- Header ---
  doc
    .fontSize(20)
    .fillColor("#4f46e5")
    .text("📦 Smart Inventory Executive Report", { align: "left" });
  doc
    .fontSize(10)
    .fillColor("#6b7280")
    .text(`Generated on: ${new Date().toLocaleString()}`, { align: "left" });
  doc.moveDown(1.5);

  // --- Summary Metrics ---
  const totalItems = allItems.length;
  const totalValue = allItems.reduce(
    (acc, item) => acc + Number(item.price) * Number(item.stock_count),
    0,
  );
  const lowStockCount = allItems.filter(
    (item) => Number(item.stock_count) <= 5,
  ).length;

  doc.rect(50, doc.y, 495, 60).fillAndStroke("#f3f4f6", "#e5e7eb");
  const currentY = doc.y + 15;
  doc.fillColor("#111827").fontSize(12).font("Helvetica-Bold");
  doc.text(`Total Items: ${totalItems}`, 70, currentY);
  doc.text(`Total Asset Value: $${totalValue.toFixed(2)}`, 220, currentY);
  doc.fillColor(lowStockCount > 0 ? "#dc2626" : "#111827");
  doc.text(`Low Stock Items: ${lowStockCount}`, 400, currentY);
  doc.font("Helvetica"); // Reset font
  doc.moveDown(3);

  // --- Inventory Table Header ---
  doc
    .fontSize(14)
    .fillColor("#111827")
    .text("Inventory Items Breakdown", { underline: true });
  doc.moveDown(0.5);

  const tableTop = doc.y;
  doc.fontSize(10).fillColor("#374151").font("Helvetica-Bold");
  doc.text("Item Name", 50, tableTop);
  doc.text("Category", 200, tableTop);
  doc.text("Stock", 350, tableTop);
  doc.text("Price", 430, tableTop);

  doc
    .moveTo(50, tableTop + 15)
    .lineTo(545, tableTop + 15)
    .strokeColor("#e5e7eb")
    .stroke();
  doc.font("Helvetica").fillColor("#4b5563");

  let y = tableTop + 25;

  // --- Table Rows ---
  allItems.forEach((item, index) => {
    // Check if we need a new page
    if (y > 700) {
      doc.addPage();
      y = 50;
    }

    doc.text(item.name, 50, y, { width: 140, truncate: true });
    doc.text(item.category_name || "Uncategorized", 200, y, {
      width: 140,
      truncate: true,
    });

    // Highlight low stock in red text
    if (Number(item.stock_count) <= 5) {
      doc.fillColor("#dc2626").font("Helvetica-Bold");
      doc.text(`${item.stock_count} (Low)`, 350, y);
      doc.fillColor("#4b5563").font("Helvetica");
    } else {
      doc.text(item.stock_count.toString(), 350, y);
    }

    doc.text(`$${Number(item.price).toFixed(2)}`, 430, y);

    y += 20;
  });

  // --- Footer ---
  doc
    .fontSize(8)
    .fillColor("#9ca3af")
    .text(
      "Smart Inventory Management System — Powered by Node.js & Google Gemini",
      50,
      750,
      { align: "center", width: 495 },
    );

  // Finalize PDF file
  doc.end();
}

module.exports = { generateInventoryPDF };
