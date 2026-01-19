import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { qdrant } from "../vectorstore/qdrant.js";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ Gemini embedding size
const GEMINI_EMBED_DIM = 3072;

function cleanText(text) {
  return text
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * PDF → [{ text, page }]
 */
async function extractPdfChunks(fileBuffer) {
  const data = new Uint8Array(fileBuffer);
  const loadingTask = getDocument({ data });
  const pdfDoc = await loadingTask.promise;

  const chunks = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();

    const text = content.items
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text) chunks.push({ text, page: pageNum });
  }

  return chunks;
}

async function ensureCollection(collectionName) {
  try {
    console.log(`🔍 Checking if collection exists: ${collectionName}`);
    const collections = await qdrant.getCollections();

    const exists = collections.collections.some((col) => col.name === collectionName);

    if (!exists) {
      console.log(`🆕 Creating new Qdrant collection: ${collectionName}`);
      await qdrant.createCollection(collectionName, {
        vectors: { size: GEMINI_EMBED_DIM, distance: "Cosine" },
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log(`✅ Collection ${collectionName} created and ready`);
    } else {
      console.log(`✅ Collection ${collectionName} already exists — continuing ingestion`);
    }
  } catch (err) {
    console.error("❌ Failed to ensure collection:", err);
    throw err;
  }
}

async function uploadInBatches(collectionName, points, batchSize = 100) {
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    await qdrant.upsert(collectionName, { points: batch });
    console.log(`📤 Uploaded batch ${i / batchSize + 1} (${batch.length} points)`);
  }
}

export async function ingestFile(file, country) {
  console.log(`📥 Ingesting file: ${file.originalname} for country: ${country}`);

  const absPath = path.resolve(file.path);

  try {
    const fileBuffer = await fs.readFile(absPath);

    let rawChunks = [];

    if (file.mimetype === "application/pdf") {
      rawChunks = await extractPdfChunks(fileBuffer);
    } else if (file.mimetype.startsWith("text/")) {
      rawChunks = [{ text: fileBuffer.toString("utf8"), page: 1 }];
    } else {
      throw new Error(`Unsupported mimetype for ingestion: ${file.mimetype}`);
    }

    const seenChunks = new Set();
    const paragraphs = rawChunks
      .map(({ text, page }) => ({ text: cleanText(text), page }))
      .filter((p) => p.text !== "" && !seenChunks.has(p.text) && seenChunks.add(p.text));

    console.log(`📄 Cleaned to ${paragraphs.length} unique, non-empty chunks`);

    const collection = `legal_chunks_${country.toLowerCase()}-gm`;
    await ensureCollection(collection);

    console.log(`🔄 Preparing to upload ${paragraphs.length} chunks to collection: ${collection}`);

    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const points = [];

    for (let i = 0; i < paragraphs.length; i++) {
      let { text: chunk, page } = paragraphs[i];

      if (chunk.length > 3000) {
        console.warn(`⚠️ Chunk ${i} too long (${chunk.length} chars). Truncating.`);
        chunk = chunk.slice(0, 3000);
      }

      let success = false;
      let retries = 0;
      const maxRetries = 5;

      while (!success && retries < maxRetries) {
        try {
          const result = await embeddingModel.embedContent({
            content: { parts: [{ text: chunk }] },
          });

          const vector = result.embedding.values;

          points.push({
            id: uuidv4(),
            vector,
            payload: {
              text: chunk,
              country,
              source: file.originalname,
              page,
            },
          });

          success = true;
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (err) {
          if (String(err?.message || "").includes("429")) {
            retries++;
            const backoff = 1000 * retries ** 2;
            console.warn(`⏳ 429 rate limit hit. Retrying chunk ${i} in ${backoff} ms (attempt ${retries})`);
            await new Promise((resolve) => setTimeout(resolve, backoff));
          } else {
            console.error(`⚠️ Embedding failed for chunk ${i}: ${err.message}`);
            break;
          }
        }
      }
    }

    if (points.length) {
      await uploadInBatches(collection, points);
      console.log(`✅ Uploaded ${points.length} chunks to ${collection}`);
    } else {
      console.warn(`⚠️ No valid chunks found in ${file.originalname}`);
    }
  } finally {
    console.log(`🗑️ Cleaning up temporary file: ${absPath}`);
    try {
      await fs.unlink(absPath);
    } catch {
      // ignore cleanup errors
    }
  }
}
