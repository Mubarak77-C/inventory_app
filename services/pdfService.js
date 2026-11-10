// services/pdfService.js
const PDFDocument = require("pdfkit");

function generateInventoryPDF(allItems, res) {
  // Create a new PDF document with standard margins
  const doc = new PDFDocument({ margin: 50, size: "A4" });

  // Pipe the PDF directly to the HTTP response stream
  doc.pipe(res);

  // --- Header (Strictly constrained to 1 line with width) ---
  doc
    .fontSize(18)
    .fillColor("#4f46e5")
    .font("Helvetica-Bold")
    .text("Smart Inventory Executive Report", 50, 50, { width: 495 });

  doc
    .fontSize(10)
    .fillColor("#6b7280")
    .font("Helvetica")
    .text(`Generated on: ${new Date().toLocaleString()}`, 50, 75, {
      width: 495,
    });

  doc.moveDown(1.5);

  // --- Summary Metrics Box ---
  const totalItems = allItems.length;
  const totalValue = allItems.reduce(
    (acc, item) => acc + Number(item.price) * Number(item.stock_count),
    0,
  );
  const lowStockCount = allItems.filter(
    (item) => Number(item.stock_count) <= 5,
  ).length;

  const summaryY = doc.y;
  doc.rect(50, summaryY, 495, 55).fillAndStroke("#f3f4f6", "#e5e7eb");

  const metricTextY = summaryY + 18;
  doc.fillColor("#111827").fontSize(11).font("Helvetica-Bold");
  doc.text(`Total Items: ${totalItems}`, 65, metricTextY);
  doc.text(`Asset Value: $${totalValue.toFixed(2)}`, 200, metricTextY);
  doc.fillColor(lowStockCount > 0 ? "#dc2626" : "#111827");
  doc.text(`Low Stock: ${lowStockCount}`, 380, metricTextY);

  doc.font("Helvetica"); // Reset font
  doc.y = summaryY + 75; // Move past the box securely

  // --- Inventory Table Header ---
  doc
    .fontSize(13)
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .text("Inventory Items Breakdown", 50, doc.y, { width: 495 });
  doc.moveDown(0.5);

  const tableTop = doc.y;
  doc.fontSize(10).fillColor("#374151").font("Helvetica-Bold");
  doc.text("Item Name", 50, tableTop, { width: 140 });
  doc.text("Category", 200, tableTop, { width: 130 });
  doc.text("Stock", 350, tableTop, { width: 60 });
  doc.text("Price", 430, tableTop, { width: 65 });

  doc
    .moveTo(50, tableTop + 15)
    .lineTo(545, tableTop + 15)
    .strokeColor("#e5e7eb")
    .stroke();
  doc.font("Helvetica").fillColor("#4b5563");

  let y = tableTop + 25;

  // --- Table Rows ---
  allItems.forEach((item) => {
    // Check if we need a new page to prevent overflow
    if (y > 730) {
      doc.addPage();
      y = 50;
    }

    doc.text(item.name || "", 50, y, {
      width: 140,
      lineBreak: false,
      ellipsis: true,
    });
    doc.text(item.category_name || "Uncategorized", 200, y, {
      width: 130,
      lineBreak: false,
      ellipsis: true,
    });

    // Highlight low stock
    const stockNum = Number(item.stock_count);
    if (stockNum <= 5) {
      doc.fillColor("#dc2626").font("Helvetica-Bold");
      doc.text(`${stockNum} (Low)`, 350, y, { width: 70, lineBreak: false });
      doc.fillColor("#4b5563").font("Helvetica");
    } else {
      doc.text(stockNum.toString(), 350, y, { width: 70, lineBreak: false });
    }

    doc.text(`$${Number(item.price).toFixed(2)}`, 430, y, {
      width: 65,
      lineBreak: false,
    });

    y += 22; // Row spacing
  });

  // --- Footer ---
  doc
    .fontSize(8)
    .fillColor("#9ca3af")
    .text(
      "Smart Inventory Management System — Powered by Node.js & Google Gemini",
      50,
      770,
      { align: "center", width: 495 },
    );

  // Finalize PDF file
  doc.end();
}

module.exports = { generateInventoryPDF };
