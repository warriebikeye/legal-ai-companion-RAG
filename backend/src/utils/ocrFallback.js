import Tesseract from "tesseract.js";
import { pdf } from "pdf-to-img";

export const OCR_FALLBACK_THRESHOLD = 100;

export function needsOcrFallback(text) {
    return !text || text.replace(/\s/g, "").length < OCR_FALLBACK_THRESHOLD;
}

export async function ocrPdfBuffer(pdfBuffer) {
    const pages = await pdf(pdfBuffer, { scale: 2 }); // scale 2 = ~200dpi

    console.log(`🖼️  pdf-to-img detected ${pages.length} page(s) for OCR`);

    const pageTexts = [];
    let i = 0;

    for await (const pageBuffer of pages) {  // ✅ async iterator
        const result = await Tesseract.recognize(pageBuffer, "eng");
        const text = result?.data?.text || "";
        console.log(`🔍 OCR page ${++i}: ${text.length} chars extracted`);
        pageTexts.push(text);
    }

    const finalText = pageTexts.join("\n\n").trim();
    console.log(`✅ OCR complete — total ${finalText.length} chars recovered`);
    return finalText;
}