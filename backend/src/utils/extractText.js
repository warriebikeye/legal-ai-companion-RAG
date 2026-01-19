import fs from "fs/promises";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * Returns: [{ text, page }]
 */
export async function extractText(filePath, mimeType) {
  // Always resolve path (safer on Render)
  const absPath = filePath; // filePath from multer is already usable; keep as-is

  if (mimeType === "application/pdf") {
    const buffer = await fs.readFile(absPath);

    // pdfjs in Node: worker not needed
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;

    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      const pageText = content.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");

      pages.push({
        page: i,
        text: normalize(pageText),
      });
    }

    return pages; // [{ page, text }]
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const buffer = await fs.readFile(absPath);
    const result = await mammoth.extractRawText({ buffer });

    return [
      {
        page: 1,
        text: normalize(result.value),
      },
    ];
  }

  if (mimeType === "text/plain" || mimeType?.startsWith("text/")) {
    const text = await fs.readFile(absPath, "utf-8");
    return [
      {
        page: 1,
        text: normalize(text),
      },
    ];
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
