import Tesseract from "tesseract.js";
import fs from "fs/promises";
import path from "path";
import pdf from "../utils/pdfParseWrapper.cjs";
import { ocrPdfBuffer, needsOcrFallback } from "../utils/ocrFallback.js"; // ✅ NEW

/**
 * Extract text from PDF using Node-safe parser.
 * Falls back to Tesseract OCR if the PDF is image-based (scanned).
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractPdfText(buffer) {
  const data = await pdf(buffer);

  const text = (data.text || "")
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim();

  // ✅ NEW: if pdf-parse returned near-nothing, the PDF is likely image-based
  if (needsOcrFallback(text)) {
    console.warn("⚠️  pdf-parse returned empty text — attempting OCR fallback");
    try {
      const ocrText = await ocrPdfBuffer(buffer);
      return ocrText.replace(/\s+/g, " ").replace(/[\x00-\x1F\x7F]/g, "").trim();
    } catch (ocrErr) {
      console.error(`❌ OCR fallback failed: ${ocrErr.message}`);
      return ""; // graceful degradation
    }
  }
  return text;
}

export class ExtractionService {
  // ✅ UNCHANGED in signature — OCR fallback is transparent to callers
  async extractFromPDF(buffer) {
    return await extractPdfText(buffer);
  }

  async extractFromTXT(buffer) {
    return buffer.toString("utf8");
  }

  async extractFromImage(buffer) {
    // OCR path remains unchanged (this is correct usage)
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

      // optional cleanup if multer stores temp files
      // await fs.unlink(absPath);
    }

    return finalText.trim();
  }
}