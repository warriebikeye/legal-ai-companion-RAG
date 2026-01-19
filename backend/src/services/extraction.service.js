import Tesseract from "tesseract.js";
import fs from "fs/promises";
import path from "path";

// ✅ pdfjs-dist works reliably on Render/Node without pdf-parse debug behavior
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Extract per-page text using pdfjs
 * @param {Uint8Array} data
 * @returns {Promise<Array<{text: string, page: number}>>}
 */
async function extractPdfPages(data) {
  const loadingTask = getDocument({ data });
  const pdfDoc = await loadingTask.promise;

  const pages = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();

    // Join extracted text items
    const text = content.items
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    pages.push({ text, page: pageNum });
  }

  return pages;
}

export class ExtractionService {
  async extractFromPDF(buffer) {
    const data = new Uint8Array(buffer);
    const pages = await extractPdfPages(data);

    // If you want a single combined string:
    return pages.map((p) => p.text).filter(Boolean).join("\n\n");
  }

  async extractFromTXT(buffer) {
    return buffer.toString("utf8");
  }

  async extractFromImage(buffer) {
    const result = await Tesseract.recognize(buffer, "eng");
    return result?.data?.text || "";
  }

  async extract(files) {
    if (!files || files.length === 0) return "";

    let finalText = "";

    for (const file of files) {
      const absPath = path.resolve(file.path);
      const buffer = await fs.readFile(absPath);

      if (file.mimetype === "application/pdf") {
        finalText += await this.extractFromPDF(buffer);
      } else if (file.mimetype.startsWith("text/")) {
        finalText += await this.extractFromTXT(buffer);
      } else if (file.mimetype.startsWith("image/")) {
        finalText += await this.extractFromImage(buffer);
      } else {
        console.warn(`Unsupported file: ${file.originalname}`);
      }

      finalText += "\n\n";

      // optional: delete temp file here if you want (only if multer stores temp files)
      // await fs.unlink(absPath);
    }

    return finalText.trim();
  }
}
