// src/services/rag.service.js

import { qdrant } from "../vectorstore/qdrant.js";
import redis from "./redis.js";
import * as geminiLLM from "../llm/gemini.js";
import User from "../models/User.js";
import { retrieveDocumentContext } from "./documentRetriever.service.js";
import { getCachedQueryEmbedding } from "./queryEmbeddingCache.service.js";
import { generateQueryCacheKey } from "../utils/queryCache.js";

const QUERY_CACHE_TTL = 60 * 60; // 1 hour

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[RAG] [${timestamp}] ${step}`, data)
    : console.log(`[RAG] [${timestamp}] ${step}`);
}

function compress(text = "", max = 4000) {
  return text?.length > max ? text.slice(0, max) : text;
}

function isSmallTalk(text = "") {
  return ["hi", "hello", "hey", "thanks", "thank you"].includes(
    text.toLowerCase().replace(/[^\w\s]/g, "").trim()
  );
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

/**
 * Pure RAG function — no DB, no conversation persistence.
 * All conversation orchestration is handled by the controller.
 *
 * @param {string} query
 * @param {string} country
 * @param {string} extraContext - extracted document text
 * @param {object} options
 * @param {string} options.userId
 * @param {string} options.conversationId
 * @param {string} options.historyText - pre-built history string from controller
 * @param {string} options.retrievalMode
 */
export async function getRAGAnswer(query, country, extraContext = "", options = {}) {
  const start = Date.now();

  const {
    userId,
    conversationId,
    historyText = "",        // ✅ injected by controller, not fetched here
    retrievalMode = "qa_retrieval",
  } = options;

  if (!userId) throw new Error("userId is required");

  try {
    /* =========================================================
       SMALL TALK SHORTCUT
    ========================================================= */

    if (isSmallTalk(query)) {
      return {
        answer: "Hello! How can I assist you with a legal question today?",
        sources: [],
        conversationId,
        documentMode: "none",
      };
    }

    /* =========================================================
       CACHE CHECK
       Only cache non-conversational queries (no history)
    ========================================================= */

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

    /* =========================================================
       USER TIER
    ========================================================= */

    const user = await User.findById(userId).select("subscriptionTier").lean();
    const userTier = user?.subscriptionTier || "free";

    log("RAG START", { userTier, retrievalMode, isConversational });

    /* =========================================================
       EMBEDDING
    ========================================================= */

    const embedding = await getCachedQueryEmbedding(query);
    log("Embedding generated");

    /* =========================================================
       PARALLEL RETRIEVAL — document chunks + legal context
    ========================================================= */

    const [documentResult, legalResults] = await Promise.all([
      conversationId
        ? retrieveDocumentContext({
            queryEmbedding: embedding,
            conversationId,
            mode: retrievalMode,
            topK: userTier === "premium" ? 10 : 5,
          })
        : Promise.resolve({ chunks: [], mode: "none" }),

      qdrant.search(`legal_chunks_${country.toLowerCase()}-gm`, {
        vector: embedding,
        top: 5,
        with_payload: true,
      }),
    ]);

    log("Retrieval complete", {
      documentChunks: documentResult.chunks.length,
      legalResults: legalResults.length,
    });

    /* =========================================================
       BUILD CONTEXTS
    ========================================================= */

    const documentContext = documentResult.chunks.map((c) => c.text).join("\n\n");

    const legalChunks = legalResults.filter((r) => r.payload?.text);

    const legalContext = legalChunks
      .map((r) => {
        const src = r.payload?.source ? `[Source: ${r.payload.source}]` : "";
        return `${src}\n${r.payload.text}`;
      })
      .join("\n\n---\n\n");

    const sources = [...new Set(legalChunks.map((r) => r.payload?.source).filter(Boolean))];

    /* =========================================================
       SYSTEM PROMPT
    ========================================================= */

    const systemPrompt = `You are a legal AI assistant specializing in ${country} law.

Rules:
- Use ONLY the provided context. Do not invent legal facts.
- Be precise, clear, and accessible to a layperson.
- When citing a source, use the filename from the [Source: filename] tag.
- Format citations as: **Source:** \`Section X of filename states: "..."\`
- Present quoted contexts as lists.
- If conversation history is provided, treat the latest message as a follow-up.
- End every response with: "_Disclaimer: This is not legal advice. Please consult a qualified lawyer._"`;

    /* =========================================================
       BUILD FINAL PROMPT
    ========================================================= */

    const prompt = buildPrompt({
      systemPrompt,
      historyText,
      documentContext,
      legalContext,
      extraContext: compress(extraContext, 2000),
      query,
    });

    /* =========================================================
       LLM GENERATION
    ========================================================= */

    const { response, modelUsed, latencyMs } = await geminiLLM.getAnswer({
      query,
      context: prompt,
      systemPrompt,
      userTier,
      taskType: "document_analysis",
    });

    log("Gemini done", { modelUsed, latencyMs });

    /* =========================================================
       FINAL RESPONSE
    ========================================================= */

    const finalResponse = {
      answer: response,
      sources,
      documentMode: documentResult.mode,
      conversationId,
      modelUsed,
      latencyMs,
      durationMs: Date.now() - start,
    };

    /* =========================================================
       CACHE (non-conversational only)
    ========================================================= */

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