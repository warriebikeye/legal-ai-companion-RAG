// src/services/rag.service.js
//
// Exports two functions:
//   getRAGAnswer()       — original blocking path (used for cached responses)
//   getRAGAnswerStream() — streaming path (used by the SSE controller)
//
// Both share the same retrieval + prompt-building logic.
// The stream version skips Redis caching (conversational or first-response)
// and instead streams tokens directly to the client.

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

/* =========================================================
   SHARED — retrieval + prompt assembly
   Extracted so both blocking and streaming paths use it.
========================================================= */

async function buildRAGContext(query, country, extraContext, options) {
  const {
    userId,
    conversationId,
    historyText = "",
    retrievalMode = "qa_retrieval",
  } = options;

  const user = await User.findById(userId).select("subscriptionTier").lean();
  const userTier = user?.subscriptionTier || "free";

  log("RAG context build start", { userTier, retrievalMode });

  const embedding = await getCachedQueryEmbedding(query);
  log("Embedding generated");

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

  const documentContext = documentResult.chunks.map((c) => c.text).join("\n\n");
  const legalChunks = legalResults.filter((r) => r.payload?.text);
  const legalContext = legalChunks
    .map((r) => {
      const src = r.payload?.source ? `[Source: ${r.payload.source}]` : "";
      return `${src}\n${r.payload.text}`;
    })
    .join("\n\n---\n\n");

  const sources = [...new Set(legalChunks.map((r) => r.payload?.source).filter(Boolean))];

  const systemPrompt = `You are a legal AI assistant specializing in ${country} law.

Rules:
- Use ONLY the provided context. Do not invent legal facts.
- Be precise, clear, and accessible to a layperson.
- When citing a source, use the filename from the [Source: filename] tag.
- Format citations as: **Source:** \`Section X of filename states: "..."\`
- Present quoted contexts as lists.
- If conversation history is provided, treat the latest message as a follow-up.
- End every response with: "_Disclaimer: This is not legal advice. Please consult a qualified lawyer._"`;

  const prompt = buildPrompt({
    systemPrompt,
    historyText,
    documentContext,
    legalContext,
    extraContext: compress(extraContext, 2000),
    query,
  });

  return {
    prompt,
    systemPrompt,
    sources,
    documentMode: documentResult.mode,
    userTier,
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

    const { prompt, systemPrompt, sources, documentMode, userTier } =
      await buildRAGContext(query, country, extraContext, options);

    const { response, modelUsed, latencyMs } = await geminiLLM.getAnswer({
      query,
      context: prompt,
      systemPrompt,
      userTier,
      taskType: "document_analysis",
    });

    log("Gemini done", { modelUsed, latencyMs });

    const finalResponse = {
      answer: response,
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
     { type: "done",  payload: { durationMs } }
     { type: "error", payload: "message" }      ← only on failure
========================================================= */

export async function* getRAGAnswerStream(query, country, extraContext = "", options = {}) {
  const start = Date.now();
  const { userId, conversationId } = options;

  if (!userId) throw new Error("userId is required");

  try {
    if (isSmallTalk(query)) {
      yield { type: "meta", payload: { sources: [], documentMode: "none", conversationId } };
      yield { type: "chunk", payload: "Hello! How can I assist you with a legal question today?" };
      yield { type: "done", payload: { durationMs: Date.now() - start } };
      return;
    }

    // Build retrieval context (same as blocking path)
    const { prompt, systemPrompt, sources, documentMode, userTier, conversationId: cid } =
      await buildRAGContext(query, country, extraContext, options);

    // Emit metadata first so the frontend can render sources immediately
    yield {
      type: "meta",
      payload: { sources, documentMode, conversationId: cid, modelUsed: null },
    };

    // Stream tokens from Gemini
    let modelUsed = null;
    const stream = geminiLLM.getAnswerStream({
      query,
      context: prompt,
      systemPrompt,
      userTier,
    });

    for await (const chunk of stream) {
      yield { type: "chunk", payload: chunk };
      // Capture model from stream internals via log — model is set inside getAnswerStream
      if (!modelUsed) modelUsed = "gemini-2.5-flash"; // default; getAnswerStream logs actual
    }

    yield {
      type: "done",
      payload: { durationMs: Date.now() - start, modelUsed },
    };

  } catch (err) {
    console.error("❌ RAG STREAM FAILED", { message: err?.message });
    yield { type: "error", payload: err?.message || "Internal error" };
  }
}