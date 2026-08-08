import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import pdf from "../utils/pdfParseWrapper.cjs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { qdrant, ensurePayloadIndex } from "../vectorstore/qdrant.js";
import { ocrPdfBuffer, needsOcrFallback } from "../utils/ocrFallback.js"; // ✅ NEW
import { generateDocumentHash } from "../utils/hash.js";

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
 * Extract text chunks from a PDF buffer.
 * Falls back to Tesseract OCR when pdf-parse yields no usable text
 * (i.e. the PDF is image-based / scanned).
 */
async function extractPdfChunks(fileBuffer) {
  const data = await pdf(fileBuffer);
  let fullText = cleanText(data.text || "");

  // ✅ NEW: OCR fallback for image-based PDFs
  if (needsOcrFallback(fullText)) {
    console.warn("⚠️  pdf-parse returned empty text — attempting OCR fallback");
    try {
      const ocrText = await ocrPdfBuffer(fileBuffer);
      fullText = cleanText(ocrText);
      console.log(`✅ OCR recovered ${fullText.length} chars`);
    } catch (ocrErr) {
      console.error(`❌ OCR fallback failed: ${ocrErr.message}`); // ← this will tell you exactly why
    }
  }

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

    // Needed so we can filter/scroll by documentHash (duplicate detection).
    await ensurePayloadIndex(collectionName, "documentHash", "keyword");
  } catch (err) {
    console.error("❌ Failed to ensure collection:", err);
    throw err;
  }
}

/**
 * Retry an embedContent call with exponential backoff, but only for
 * rate-limit (429) errors — anything else is rethrown immediately.
 */
async function embedWithRetry(embeddingModel, chunk, { maxRetries = 5, baseDelay = 1000 } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const result = await embeddingModel.embedContent({
        content: { parts: [{ text: chunk }] },
      });
      return result.embedding.values;
    } catch (err) {
      const is429 =
        err?.status === 429 || /429|rate limit|quota|resource_exhausted/i.test(err?.message || "");

      attempt++;
      if (!is429 || attempt > maxRetries) throw err;

      const delay = baseDelay * 2 ** (attempt - 1);
      console.warn(`⚠️ Gemini 429 — retrying embed in ${delay}ms (attempt ${attempt}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Returns true if a point with this documentHash already exists in the
 * collection — used to skip re-ingesting a file whose exact bytes were
 * already processed.
 */
async function hasDocumentHash(collectionName, documentHash) {
  const result = await qdrant.scroll(collectionName, {
    limit: 1,
    with_payload: false,
    with_vector: false,
    filter: {
      must: [{ key: "documentHash", match: { value: documentHash } }],
    },
  });

  return (result?.points?.length || 0) > 0;
}

/**
 * Core chunk → embed → upsert pipeline, shared by the multer-upload routes
 * and the folder-watcher ingestion job.
 *
 * strict=true (folder-watcher): a chunk that fails to embed after retries
 * aborts the whole file instead of silently uploading a partial document —
 * the caller should leave the source file in place so it gets retried.
 * strict=false (upload routes, existing behavior): failed chunks are
 * skipped and ingestion continues with whatever embedded successfully.
 */
async function ingestBuffer({ buffer, originalname, mimetype, country, documentHash, strict = false }) {
  let rawChunks = [];

  if (mimetype === "application/pdf") {
    rawChunks = await extractPdfChunks(buffer);
  } else if (mimetype.startsWith("text/")) {
    rawChunks = [{ text: buffer.toString("utf8"), page: 1 }];
  } else {
    throw new Error(`Unsupported mimetype for ingestion: ${mimetype}`);
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
      const vector = await embedWithRetry(embeddingModel, chunk);

      points.push({
        id: uuidv4(),
        vector,
        payload: {
          text: chunk,
          country,
          source: originalname,
          page,
          documentHash,
        },
      });

      if ((i + 1) % 10 === 0 || i === paragraphs.length - 1) {
        console.log(`📈 Embedded ${i + 1}/${paragraphs.length} chunks for "${originalname}"`);
      }

      // ✅ smoother rate limiting (prevents Gemini 429 storms)
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (err) {
      console.error(`⚠️ Embedding failed for chunk ${i}: ${err.message}`);
      if (strict) {
        throw new Error(`Embedding failed for chunk ${i} of ${originalname}: ${err.message}`);
      }
    }
  }

  if (points.length) {
    await uploadInBatches(collection, points);
    console.log(`✅ Uploaded ${points.length} chunks to ${collection}`);
  } else {
    console.warn(`⚠️ No valid chunks found in ${originalname}`);
  }

  return { chunksUploaded: points.length, collection };
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
    const documentHash = generateDocumentHash(fileBuffer);

    await ingestBuffer({
      buffer: fileBuffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      country,
      documentHash,
      strict: false,
    });
  } finally {
    console.log(`🗑️ Cleaning up temporary file: ${absPath}`);
    try {
      await fs.unlink(absPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Used by the folder-watcher job (POST /ask/train/folder). Unlike
 * ingestFile(), this never deletes the source file — the caller (worker)
 * moves TO -> DONE only after this resolves successfully, so a crash or
 * exhausted-retry failure leaves the file in TO to be retried later.
 *
 * Skips embedding entirely (cheap, no Gemini calls) if a point with the
 * same documentHash is already in the country's collection.
 */
export async function ingestFolderFile({ filePath, originalname, country, mimetype = "application/pdf" }) {
  const startedAt = Date.now();
  console.log(`[FOLDER_INGEST] 📥 Ingesting "${originalname}" for country: ${country}`);

  const buffer = await fs.readFile(filePath);
  const documentHash = generateDocumentHash(buffer);
  const collection = `legal_chunks_${country.toLowerCase()}-gm`;

  console.log(`[FOLDER_INGEST] 🔑 Hash computed for "${originalname}": ${documentHash}`);

  await ensureCollection(collection);

  if (await hasDocumentHash(collection, documentHash)) {
    console.log(`[FOLDER_INGEST] ⏭️ Duplicate content (hash match) — skipping embed: "${originalname}"`);
    return { duplicate: true, chunksUploaded: 0, collection, durationMs: Date.now() - startedAt };
  }

  console.log(`[FOLDER_INGEST] 🆕 No hash match — proceeding to chunk + embed: "${originalname}"`);

  const { chunksUploaded } = await ingestBuffer({
    buffer,
    originalname,
    mimetype,
    country,
    documentHash,
    strict: true,
  });

  const durationMs = Date.now() - startedAt;
  console.log(`[FOLDER_INGEST] ✅ Finished "${originalname}" in ${durationMs}ms (${chunksUploaded} chunks)`);

  return { duplicate: false, chunksUploaded, collection, durationMs };
}