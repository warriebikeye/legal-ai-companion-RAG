import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import pdf from "../utils/pdfParseWrapper.cjs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { qdrant } from "../vectorstore/qdrant.js";

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
 * ✅ CHANGED: Simpler + Node-safe PDF extraction using pdf-parse
 * Instead of rendering pages like pdfjs, we extract raw text once
 * and split into logical chunks.
 */
async function extractPdfChunks(fileBuffer) {
  const data = await pdf(fileBuffer);

  // pdf-parse already merges all page text safely
  const fullText = cleanText(data.text);

  // Split into semantic chunks (better for embeddings than per-page)
  const chunkSize = 1200; // ideal for Gemini embeddings
  const overlap = 200;

  const chunks = [];
  let index = 0;

  while (index < fullText.length) {
    const slice = fullText.slice(index, index + chunkSize);

    chunks.push({
      text: slice,
      page: Math.floor(index / 3000) + 1, // pseudo-page reference
    });

    index += chunkSize - overlap;
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
      rawChunks = await extractPdfChunks(fileBuffer); // ✅ now uses pdf-parse pipeline
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

      // ✅ safer truncation aligned to embedding limits
      if (chunk.length > 2000) {
        chunk = chunk.slice(0, 2000);
      }

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

        // ✅ smoother rate limiting (prevents Gemini 429 storms)
        await new Promise((resolve) => setTimeout(resolve, 120));
      } catch (err) {
        console.error(`⚠️ Embedding failed for chunk ${i}: ${err.message}`);
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