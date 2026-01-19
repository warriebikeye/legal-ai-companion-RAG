import * as pdf from 'pdf-parse'; // ✅ NODE-SAFE IMPORT
import Tesseract from "tesseract.js";
import fs from "fs/promises";

export class ExtractionService {
  async extractFromPDF(buffer) {
    const data = await pdf(buffer);
    return data?.text || "";
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
      const buffer = await fs.readFile(file.path);

      if (file.mimetype === "application/pdf") {
        finalText += await this.extractFromPDF(buffer);
      }
      else if (file.mimetype.startsWith("text/")) {
        finalText += await this.extractFromTXT(buffer);
      }
      else if (file.mimetype.startsWith("image/")) {
        finalText += await this.extractFromImage(buffer);
      }
      else {
        console.warn(`Unsupported file: ${file.originalname}`);
      }

      finalText += "\n\n";
    }

    return finalText.trim();
  }
}
