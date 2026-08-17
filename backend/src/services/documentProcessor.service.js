// src/services/documentProcessor.service.js

import pLimit from "p-limit";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

import { withTimeout } from "../utils/withTimeout.js";
import { acquireLock, releaseLock } from "../utils/distributedLock.js";

import redis from "./redis.js";
import * as geminiLLM from "../llm/gemini.js";
import { chunkText } from "../utils/textChunker.js";
import { generateDocumentHash } from "../utils/hash.js";
import { ExtractionService } from "./extraction.service.js";
import { qdrant, USER_DOCS_COLLECTION } from "../vectorstore/qdrant.js";
import { extractParagraphs, paragraphsToText } from "./docxStructure.service.js";
import { DOCX_MIME } from "./documentTemplate.service.js";

const extractor = new ExtractionService();

/* =========================================================
   CONFIG
========================================================= */

const EXTRACTION_CACHE_TTL = 60 * 60 * 24;
const EMBEDDING_CONCURRENCY = 5;
const VECTOR_TTL_HOURS = 24;

/* =========================================================
   LOGGER
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[DOCUMENT_PROCESSOR] [${timestamp}] ${step}`, data);
  } else {
    console.log(`[DOCUMENT_PROCESSOR] [${timestamp}] ${step}`);
  }
}

/* =========================================================
   UUID HELPER
   Qdrant point IDs must be UUID v4 or unsigned integers.
   We derive a deterministic UUID from documentHash + chunkIndex
   so re-ingesting the same file produces the same point IDs
   (idempotent upsert).
========================================================= */

function chunkPointId(documentHash, chunkIndex) {
  // SHA-1 the seed, then format the first 16 bytes as a UUID v4-compatible string
  const seed = `${documentHash}::${chunkIndex}`;
  const hash = crypto.createHash("sha1").update(seed).digest("hex");
  // Format as xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx  (version 4, variant 1)
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "4" + hash.slice(13, 16),          // version nibble forced to 4
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), // variant bits
    hash.slice(20, 32),
  ].join("-");
}

/* =========================================================
   BUFFER NORMALIZER
========================================================= */

async function normalizeBuffer(file) {
  let buffer = file.buffer;

  // base64 from queue
  if (typeof buffer === "string") {
    buffer = Buffer.from(buffer, "base64");
  }

  // BullMQ serialized buffer
  if (buffer?.type === "Buffer" && Array.isArray(buffer.data)) {
    buffer = Buffer.from(buffer.data);
  }

  // disk fallback
  if (!buffer && file.path) {
    buffer = await fs.readFile(path.resolve(file.path));
  }

  if (!Buffer.isBuffer(buffer)) {
    throw new Error(`Invalid buffer for ${file.originalname}`);
  }

  return buffer;
}

/* =========================================================
   MAIN PROCESSOR
========================================================= */

export async function processUploadedDocuments({ files = [], userId, conversationId }) {
  try {
    log("====================================");
    log("DOCUMENT PROCESSING STARTED", {
      fileCount: files.length,
      userId,
      conversationId,
    });

    if (!files.length) {
      return { documents: [] };
    }

    const processedDocuments = [];

    for (const file of files) {
      let lockAcquired = false;
      let lockKey = null;

      try {
        log("Processing file", {
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        });

        /* =====================================================
           NORMALIZE BUFFER
        ===================================================== */

        const buffer = await normalizeBuffer(file);

        /* =====================================================
           HASH
        ===================================================== */

        const documentHash = generateDocumentHash(buffer);

        log("Document hash generated", { fileName: file.originalname, documentHash });

        /* =====================================================
           DISTRIBUTED LOCK
        ===================================================== */

        lockKey = `lock:doc:${documentHash}`;
        lockAcquired = await acquireLock(lockKey, 300);

        if (!lockAcquired) {
          log("⚠️ Document already processing", { documentHash });
          continue;
        }

        /* =====================================================
           EXTRACTION CACHE
        ===================================================== */

        const extractionCacheKey = `extract:${documentHash}`;
        let extractedText = await redis.get(extractionCacheKey);

        if (!extractedText) {
          log("❌ EXTRACTION CACHE MISS");

          if (file.mimetype === "application/pdf") {
            extractedText = await extractor.extractFromPDF(buffer);
          } else if (file.mimetype.startsWith("text/")) {
            extractedText = await extractor.extractFromTXT(buffer);
          } else if (file.mimetype.startsWith("image/")) {
            extractedText = await extractor.extractFromImage(buffer);
          } else if (file.mimetype === DOCX_MIME) {
            extractedText = paragraphsToText(extractParagraphs(buffer));
          } else {
            log("Unsupported file skipped", { fileName: file.originalname });
            continue;
          }

          extractedText = extractedText?.replace(/\s+/g, " ")?.trim() || "";

          await redis.set(extractionCacheKey, extractedText, {
            ex: EXTRACTION_CACHE_TTL,
          });
        }

        if (!extractedText || extractedText.length < 30) {
          log("❌ Extracted text too small");
          continue;
        }

        /* =====================================================
           SAVE DOCUMENT HASH TO CONVERSATION
        ===================================================== */

        const conversationDocsKey = `conversation_docs:${conversationId}`;
        const existingDocs = await redis.get(conversationDocsKey);

        let documentHashes = [];
        if (existingDocs) {
          documentHashes =
            typeof existingDocs === "string" ? JSON.parse(existingDocs) : existingDocs;
        }

        if (!documentHashes.includes(documentHash)) {
          documentHashes.push(documentHash);

          await redis.set(
            conversationDocsKey,
            JSON.stringify(documentHashes),
            { ex: VECTOR_TTL_HOURS * 60 * 60 }
          );

          log("Conversation document mapping saved", { conversationId, documentHash });
        }

        /* =====================================================
           CHUNKING
        ===================================================== */

        const chunks = chunkText(extractedText, { chunkSize: 1200, overlap: 200 });
        log("Chunks created", { chunkCount: chunks.length });

        /* =====================================================
           EMBEDDINGS
        ===================================================== */

        const limit = pLimit(EMBEDDING_CONCURRENCY);

        const embeddedChunks = await Promise.all(
          chunks.map((chunk, i) =>
            limit(async () => {
              const embedding = await withTimeout(geminiLLM.getEmbedding(chunk), 30000);
              return { chunkIndex: i, text: chunk, embedding };
            })
          )
        );

        /* =====================================================
           QDRANT UPSERT
           Point IDs MUST be UUID v4 strings or unsigned integers.
           Using deterministic UUIDs derived from hash + chunkIndex
           so the same file always produces the same point IDs.
        ===================================================== */

        const expiresAt = new Date(
          Date.now() + VECTOR_TTL_HOURS * 60 * 60 * 1000
        ).toISOString();

        await qdrant.upsert(USER_DOCS_COLLECTION, {
          wait: true,
          points: embeddedChunks.map((chunk) => ({
            // ✅ FIX: valid UUID instead of "hash_index" string
            id: chunkPointId(documentHash, chunk.chunkIndex),

            vector: chunk.embedding,

            payload: {
              text: chunk.text,
              documentHash,
              chunkIndex: chunk.chunkIndex,
              userId: String(userId),
              conversationId: String(conversationId),
              fileName: file.originalname,
              uploadedAt: new Date().toISOString(),
              expiresAt,
            },
          })),
        });

        log("Qdrant upsert completed", { points: embeddedChunks.length });

        processedDocuments.push({
          fileName: file.originalname,
          documentHash,
          chunkCount: embeddedChunks.length,
          extractedLength: extractedText.length,
        });

        log("✅ File processed", { fileName: file.originalname });
      } catch (fileErr) {
        console.error("❌ Failed processing file", {
          fileName: file.originalname,
          error: fileErr?.message,
          stack: fileErr?.stack,
        });
      } finally {
        if (lockAcquired && lockKey) {
          await releaseLock(lockKey);
        }
      }
    }

    return { documents: processedDocuments };
  } catch (err) {
    console.error("❌ DOCUMENT PROCESSOR FAILED", err);
    throw err;
  }
}