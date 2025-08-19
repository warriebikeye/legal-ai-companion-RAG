import fs from 'fs/promises';
import path from 'path';
import mammoth from 'mammoth';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { fileURLToPath } from 'url';

// Fix for Node.js: resolve font path properly
const __dirname = path.dirname(fileURLToPath(import.meta.url));
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = path.resolve(
  __dirname,
  '../node_modules/pdfjs-dist/standard_fonts/'
);

const { getDocument } = pdfjsLib;

export async function extractText(filePath, mimeType) {
  if (mimeType === 'application/pdf') {
    const buffer = await fs.readFile(filePath);
    const pdf = await getDocument({ data: buffer }).promise;

    let pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');

      // normalize spaces
      const cleanText = pageText.replace(/\s+/g, ' ').trim();

      pages.push({
        pageNumber: i,
        text: cleanText
      });
    }

    return pages; // [{ pageNumber, text }]
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return [
      {
        pageNumber: 1,
        text: result.value.replace(/\s+/g, ' ').trim()
      }
    ];
  }

  if (mimeType === 'text/plain') {
    const text = await fs.readFile(filePath, 'utf-8');
    return [
      {
        pageNumber: 1,
        text: text.replace(/\s+/g, ' ').trim()
      }
    ];
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
