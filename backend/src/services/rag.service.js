// src/services/rag.service.js
//
// Exports two functions:
//   getRAGAnswer()       — original blocking path (used for cached responses)
//   getRAGAnswerStream() — streaming path (used by the SSE controller)
//
// Both share the same retrieval + prompt-building logic via buildRAGContext().
//
// Model selection flows:
//   rag.service → determineTaskType() → getModelForTask() → gemini.js
//
// Context limits are also tier-aware via getContextLimits():
//   - topK retrieval results
//   - extraContext truncation length
//   - history message window (enforced upstream by the caller)

import { qdrant } from "../vectorstore/qdrant.js";
import redis from "./redis.js";
import * as geminiLLM from "../llm/gemini.js";
import User from "../models/User.js";
import { retrieveDocumentContext } from "./documentRetriever.service.js";
import { getCachedQueryEmbedding } from "./queryEmbeddingCache.service.js";
import { generateQueryCacheKey } from "../utils/queryCache.js";
import {
  determineTaskType,
  getContextLimits,
  getModelForTask,
} from "./model-router.service.js";

const QUERY_CACHE_TTL = 60 * 60; // 1 hour

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[RAG] [${timestamp}] ${step}`, data)
    : console.log(`[RAG] [${timestamp}] ${step}`);
}

function isSmallTalk(text = "") {
  return ["hi", "hello", "hey", "thanks", "thank you"].includes(
    text.toLowerCase().replace(/[^\w\s]/g, "").trim()
  );
}

/* =========================================================
   SANITIZE — strips .pdf extensions and fixes mojibake
   encoding artifacts (â€™ → ', â€œ/â€ → ", â → ')
   that appear when UTF-8 filenames are misread as Latin-1.
   Applied to: source filenames, answer text, streamed chunks.
========================================================= */
function sanitizeText(text = "") {
  return text
    .replace(/\.pdf\b/gi, "")       // strip .pdf extension
    .replace(/â€™/g, "'")           // curly apostrophe
    .replace(/â€œ/g, "\u201C")      // left double quote
    .replace(/â€\u009D/g, "\u201D") // right double quote
    .replace(/â€/g, "\u201D")       // right double quote (fallback)
    .replace(/â€"/g, "\u2013")      // en-dash
    .replace(/â€"/g, "\u2014")      // em-dash
    .replace(/âS/g, "'S")           // CHILD'S pattern
    .replace(/â/g, "'");            // catch-all remaining â artifacts
}

function buildPrompt({ systemPrompt, historyText, documentContext, legalContext, extraContext, query }) {
  return [
    systemPrompt,
    `USER QUERY:\n${query}`,
    historyText ? `CONVERSATION HISTORY:\n${historyText}` : "",
    extraContext ? `EXTRA CONTEXT:\n${extraContext}` : "",
    documentContext ? `UPLOADED DOCUMENT CONTEXT:\n${documentContext}` : "",
    legalContext ? `LEGAL CONTEXT:\n${legalContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* =========================================================
   SHARED — retrieval + prompt assembly
   Extracted so both blocking and streaming paths use it.
========================================================= */

async function buildRAGContext(query, country, extraContext = "", options = {}) {
  const {
    userId,
    conversationId,
    historyText = "",
    retrievalMode = "qa_retrieval",
  } = options;

  // ── Tier resolution ──────────────────────────────────────
  const user = await User.findById(userId).select("subscriptionTier").lean();
  const userTier = user?.subscriptionTier || "free";
  const contextLimits = getContextLimits(userTier);

  log("RAG context build start", { userTier, retrievalMode, contextLimits });

  // ── Task classification ───────────────────────────────────
  const task = determineTaskType({ query, extraContext });
  log("Task determined", { task });

  // ── Truncate extraContext to tier limit ───────────────────
  const truncatedExtraContext = extraContext?.length > contextLimits.maxExtraContextLength
    ? extraContext.slice(0, contextLimits.maxExtraContextLength)
    : extraContext;

  // ── Embeddings + parallel retrieval ──────────────────────
  const embedding = await getCachedQueryEmbedding(query);
  log("Embedding generated");

  const [documentResult, legalResults] = await Promise.all([
    conversationId
      ? retrieveDocumentContext({
          queryEmbedding: embedding,
          conversationId,
          mode: retrievalMode,
          topK: contextLimits.topKResults,
        })
      : Promise.resolve({ chunks: [], mode: "none" }),

    qdrant.search(`legal_chunks_${country.toLowerCase()}-gm`, {
      vector: embedding,
      top: contextLimits.topKResults,
      with_payload: true,
    }),
  ]);

  log("Retrieval complete", {
    documentChunks: documentResult.chunks.length,
    legalResults: legalResults.length,
    topK: contextLimits.topKResults,
  });

  // ── Assemble context strings ──────────────────────────────
  const documentContext = documentResult.chunks
    .map((c) => c.text?.slice(0, contextLimits.maxContextChunkLength))
    .join("\n\n");

  const legalChunks = legalResults.filter((r) => r.payload?.text);
  const legalContext = legalChunks
    .map((r) => {
      const src = r.payload?.source ? `[Source: ${r.payload.source}]` : "";
      const text = r.payload.text.slice(0, contextLimits.maxContextChunkLength);
      return `${src}\n${text}`;
    })
    .join("\n\n---\n\n");

  // ── Sanitize source filenames at origin ──────────────────
  // Fixes mojibake + strips .pdf before filenames ever reach
  // the system prompt or the frontend sources array.
  const sources = [
    ...new Set(
      legalChunks
        .map((r) => r.payload?.source)
        .filter(Boolean)
        .map((s) => sanitizeText(s))
    ),
  ];

  // ── Resolve model so we can flag hasLargeContext ──────────
  const promptForSizing = buildPrompt({
    systemPrompt: "",
    historyText,
    documentContext,
    legalContext,
    extraContext: truncatedExtraContext,
    query,
  });
  const hasLargeContext = promptForSizing.length > 12000;

  const resolvedModel = getModelForTask({ userTier, task, hasLargeContext });
  log("Model resolved", { resolvedModel, hasLargeContext, promptLength: promptForSizing.length });

  // ── Build system prompt ───────────────────────────────────
  const systemPrompt = `You are a legal AI assistant specializing in ${country} law.

Rules:
- Use ONLY the provided context. Do not invent legal facts.
- Be precise, clear, and accessible to a layperson.
- When citing a source, use the filename from the [Source: filename] tag but ALWAYS remove the file extension — never include ".pdf", ".docx", or any extension in your response.
- Format citations as: **Source:** \`Section X of [source name without extension] states: "..."\`
- Always complete the full sentence of any quote. Never end a quote mid-sentence or with "...". If a quote is long, include the entire relevant sentence.
- Present quoted contexts as bullet lists.
- If conversation history is provided, treat the latest message as a follow-up.
- End every response with: "_Disclaimer: This is not legal advice. Please consult a qualified lawyer._"`;

  const prompt = buildPrompt({
    systemPrompt,
    historyText,
    documentContext,
    legalContext,
    extraContext: truncatedExtraContext,
    query,
  });

  return {
    prompt,
    systemPrompt,
    sources,
    documentMode: documentResult.mode,
    userTier,
    task,
    hasLargeContext,
    resolvedModel,
    conversationId,
  };
}

/* =========================================================
   BLOCKING — original path (cache-aware)
========================================================= */

export async function getRAGAnswer(query, country, extraContext = "", options = {}) {
  const start = Date.now();
  const { userId, conversationId, historyText = "", retrievalMode = "qa_retrieval" } = options;

  if (!userId) throw new Error("userId is required");

  try {
    if (isSmallTalk(query)) {
      return {
        answer: "Hello! How can I assist you with a legal question today?",
        sources: [],
        conversationId,
        documentMode: "none",
      };
    }

    const isConversational = Boolean(historyText.trim());
    const cacheKey = generateQueryCacheKey({ query, conversationId, country, retrievalMode });

    if (!isConversational) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        log("✅ QUERY CACHE HIT");
        return typeof cached === "string" ? JSON.parse(cached) : cached;
      }
      log("❌ QUERY CACHE MISS");
    }

    const {
      prompt,
      systemPrompt,
      sources,
      documentMode,
      userTier,
      task,
      hasLargeContext,
    } = await buildRAGContext(query, country, extraContext, options);

    const { response, modelUsed, latencyMs } = await geminiLLM.getAnswer({
      query,
      context: prompt,
      systemPrompt,
      userTier,
      task,
      hasLargeContext,
    });

    log("Gemini done", { modelUsed, latencyMs });

    const finalResponse = {
      answer: sanitizeText(response), // strip .pdf + fix mojibake in answer body
      sources,
      documentMode,
      conversationId,
      modelUsed,
      latencyMs,
      durationMs: Date.now() - start,
    };

    if (!isConversational) {
      await redis.set(cacheKey, JSON.stringify(finalResponse), { ex: QUERY_CACHE_TTL });
      log("✅ Response cached", { ttl: QUERY_CACHE_TTL });
    }

    return finalResponse;
  } catch (err) {
    console.error("❌ RAG FAILED", { message: err?.message, stack: err?.stack });
    throw err;
  }
}

/* =========================================================
   STREAMING — yields { type, payload } events for the
   SSE controller to forward to the client.

   Event sequence:
     { type: "meta",  payload: { sources, documentMode, modelUsed, conversationId } }
     { type: "chunk", payload: "...text..." }   ← many of these
     { type: "done",  payload: { durationMs, modelUsed } }
     { type: "error", payload: "message" }      ← only on failure
========================================================= */

export async function* getRAGAnswerStream(query, country, extraContext = "", options = {}) {
  const start = Date.now();
  const { userId } = options;

  if (!userId) throw new Error("userId is required");

  try {
    if (isSmallTalk(query)) {
      yield {
        type: "meta",
        payload: { sources: [], documentMode: "none", conversationId: options.conversationId },
      };
      yield { type: "chunk", payload: "Hello! How can I assist you with a legal question today?" };
      yield { type: "done", payload: { durationMs: Date.now() - start } };
      return;
    }

    const {
      prompt,
      systemPrompt,
      sources,
      documentMode,
      userTier,
      task,
      hasLargeContext,
      resolvedModel,
      conversationId,
    } = await buildRAGContext(query, country, extraContext, options);

    // Emit metadata first — resolvedModel is already known from buildRAGContext
    yield {
      type: "meta",
      payload: { sources, documentMode, conversationId, modelUsed: resolvedModel },
    };

    // Stream tokens — gemini.js will call getModelForTask() with the same params
    // and arrive at the same resolvedModel
    const stream = geminiLLM.getAnswerStream({
      query,
      context: prompt,
      systemPrompt,
      userTier,
      task,
      hasLargeContext,
    });

    for await (const chunk of stream) {
      yield { type: "chunk", payload: sanitizeText(chunk) }; // strip .pdf + fix mojibake per chunk
    }

    yield {
      type: "done",
      payload: { durationMs: Date.now() - start, modelUsed: resolvedModel },
    };
  } catch (err) {
    console.error("❌ RAG STREAM FAILED", { message: err?.message });
    yield { type: "error", payload: err?.message || "Internal error" };
  }
}