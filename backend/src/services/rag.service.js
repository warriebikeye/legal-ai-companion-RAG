// src/services/rag.service.js
import { qdrant } from "../vectorstore/qdrant.js";
import redis from "./redis.js";
import * as geminiLLM from "../llm/gemini.js";

// ✅ Conversation persistence
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

const CACHE_TTL = 60 * 60; // 1 hour

/* =========================================================
   ✅ Helpers for Conversation
   ========================================================= */

function buildHistoryText(messages, summary = "") {
  const lines = messages.map((m) => {
    const who = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    return `${who}: ${m.content}`;
  });

  if (summary && summary.trim()) {
    return `SUMMARY SO FAR:\n${summary}\n\nRECENT MESSAGES:\n${lines.join("\n")}`;
  }

  return lines.join("\n");
}

async function getOrCreateConversation({ conversationId, userId, country }) {
  if (conversationId) {
    const convo = await Conversation.findOne({ _id: conversationId, userId });
    if (convo) return convo;
  }

  return Conversation.create({
    userId,
    country: (country || "nigeria").toLowerCase(),
    title: "New Chat",
    lastMessageAt: new Date(),
  });
}

async function appendMessage({
  conversationId,
  userId,
  role,
  content,
  sources = [],
  clauseAnalysis = null,
  documentText = "",
}) {
  const msg = await Message.create({
    conversationId,
    userId,
    role,
    content,
    sources,
    clauseAnalysis,
    documentText,
  });

  await Conversation.updateOne(
    { _id: conversationId, userId },
    { $set: { lastMessageAt: new Date() } }
  );

  return msg;
}

async function loadRecentMessages({ conversationId, userId, limit = 12 }) {
  const msgs = await Message.find({ conversationId, userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return msgs.reverse();
}

/* =========================================================
   ✅ RAG with Conversation Persistence
   - creates/loads conversation
   - saves user message
   - loads recent history
   - runs RAG
   - saves assistant message
   - returns answer + sources + conversationId
   ========================================================= */

/**
 * getRAGAnswer
 *
 * Backward compatible signature, but now supports conversation:
 *
 * @param {string} query
 * @param {string} country
 * @param {string} extraContext (extracted uploaded text)
 * @param {object} options
 * @param {string} options.userId (required for conversation)
 * @param {string|null} options.conversationId
 * @param {number} options.historyLimit
 * @param {string} options.userMessageOverride (optional)
 * @param {any} options.clauseAnalysis (optional store with assistant msg)
 *
 * @returns {object} { answer, sources, conversationId }
 */
export async function getRAGAnswer(
  query,
  country = "nigeria",
  extraContext = "",
  options = {}
) {
  const {
    userId = null,
    conversationId = null,
    historyLimit = 12,
    userMessageOverride = null,
    clauseAnalysis = null,
  } = options;

  // ✅ If userId not provided, fall back to original non-conversation behavior
  // (useful for internal tests or unauth flows)
  const useConversation = Boolean(userId);

  // ✅ Determine conversational history text (only if conversation enabled)
  let historyText = "";
  let convo = null;

  if (useConversation) {
    convo = await getOrCreateConversation({ conversationId, userId, country });

    // Save the user's message to DB (what user typed)
    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "user",
      content: userMessageOverride || query,
      documentText: extraContext || "",
    });

    // Load recent messages to provide continuity
    const recentMsgs = await loadRecentMessages({
      conversationId: convo._id,
      userId,
      limit: historyLimit,
    });

    historyText = buildHistoryText(recentMsgs, convo.summary || "");
  }

  const isConversational = Boolean(historyText && historyText.trim());

  // ✅ Cache key (cache only if NOT conversational)
  const cacheKey = `answer::${country}::${query}::${extraContext.slice(0, 200)}`;

  if (!isConversational) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log("💡 Served from Redis cache");
      return typeof cached === "string" ? JSON.parse(cached) : cached;
    }
  }

  // ✅ Gemini-only embedding
  let vector;
  const collection = `legal_chunks_${country.toLowerCase()}-gm`;
  console.log("💡getting vector");

  try {
    vector = await geminiLLM.getEmbedding(query);
  } catch (err) {
    console.error(`❌ Embedding failed with Gemini: ${err.message}`);
    throw err;
  }

  // ✅ Search Qdrant with Gemini vectors
  console.log("💡 searching qdrant");
  const results = await qdrant.search(collection, {
    vector,
    top: 5,
    with_payload: true,
  });

  const contextChunks = results.map((r) => r.payload.text);
  const ragContext = contextChunks.join("\n\n");

  // ✅ Sources: unique document names
  const sources = [
    ...new Set(
      results
        .map((r) => r.payload.source)
        .filter(Boolean)
    ),
  ];

  const systemPrompt = `You are a legal assistant providing information based on ${country.toUpperCase()}'s laws.

Use the provided context to answer the user's question clearly and accurately.

IMPORTANT RULES:
- Do NOT include any file names, document IDs, or source codes in your answer.
- Only include citations or references if they are legal sections (e.g., "Section 35 of the Constitution").
- The assistant response must be a clean explanation or legal guidance only.
- The list of source document IDs will be handled separately by the system. Do not mention or reference them inside the main answer.
- If conversation history is provided, remain consistent with it and treat the user's latest message as a follow-up when applicable.`;

  // ✅ Final context: history + uploaded doc text + legal context
  const fullContext =
    (historyText ? `CONVERSATION HISTORY:\n${historyText}\n\n` : "") +
    (extraContext ? `UPLOADED DOCUMENT TEXT:\n${extraContext}\n\n` : "") +
    `LEGAL CONTEXT:\n${ragContext}`;

  try {
    console.log("💡 Generating response");
    const answer = await geminiLLM.getAnswer(query, fullContext, systemPrompt);

    const response = {
      answer,
      sources,
      ...(useConversation && convo ? { conversationId: String(convo._id) } : {}),
    };

    // ✅ Cache only if not conversational
    if (!isConversational) {
      await redis.set(cacheKey, JSON.stringify(response), { ex: CACHE_TTL });
    }

    // ✅ Save assistant response if conversation enabled
    if (useConversation && convo) {
      await appendMessage({
        conversationId: convo._id,
        userId,
        role: "assistant",
        content: answer,
        sources,
        clauseAnalysis: clauseAnalysis ?? null,
        documentText: extraContext || "",
      });
    }

    return response;
  } catch (err) {
    console.error(`❌ LLM response failed with Gemini: ${err.message}`);
    throw err;
  }
}
