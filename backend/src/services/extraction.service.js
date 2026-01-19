import * as pdf from 'pdf-parse'; // ✅ NODE-SAFE IMPORT
import Tesseract from "tesseract.js";
import fs from "fs/promises";
import path from 'path';  // Path module to resolve file paths dynamically

export class ExtractionService {
  // This method now accepts filePath dynamically and checks if the file exists
  async extractFromPDF(buffer, filePath) {
    // Resolve path to an absolute path to avoid issues with relative paths in cloud environments
    const fullPath = path.resolve(filePath);

    try {
      // Check if the file exists at the full path
      await fs.access(fullPath);  // Ensure the file exists
      const data = await pdf(buffer);
      return data?.text || "";
    } catch (err) {
      console.error(`File not found at path: ${fullPath}`);
      return "";  // Return empty if file doesn't exist
    }
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

    // Iterate through files and handle extraction based on file type (PDF, text, image)
    for (const file of files) {
      const buffer = await fs.readFile(file.path);  // Read the file buffer

      if (file.mimetype === "application/pdf") {
        finalText += await this.extractFromPDF(buffer, file.path);  // Pass file path dynamically
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

    return finalText.trim();  // Clean and return the final extracted text
  }
}
