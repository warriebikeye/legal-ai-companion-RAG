// src/services/rag.service.js
import { qdrant } from "../vectorstore/qdrant.js";
import redis from "./redis.js";
import * as geminiLLM from "../llm/gemini.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

const CACHE_TTL = 60 * 60; // 1 hour

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

  // Update lastMessageAt timestamp
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
   ✅ Corrected RAG service
   - First message is title
   - Conversation created only when first message is present
   ========================================================= */
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

  if (!userId) {
    throw new Error("UserId is required for conversation.");
  }

  // ✅ Ensure we have a valid first message
  const userMessage = (userMessageOverride || query || "").trim();
  if (!userMessage) {
    throw new Error("Cannot create conversation with empty message.");
  }

  let convo = null;

  // ✅ Only create conversation if no conversationId
  if (!conversationId) {
    convo = await Conversation.create({
      userId,
      country: (country || "nigeria").toLowerCase(),
      title: userMessage.slice(0, 100),
      summary: userMessage,
      lastMessageAt: new Date(),
    });
  } else {
    convo = await Conversation.findOne({ _id: conversationId, userId });
    if (!convo) {
      // fallback: create if ID is invalid
      convo = await Conversation.create({
        userId,
        country: (country || "nigeria").toLowerCase(),
        title: userMessage.slice(0, 100),
        summary: userMessage,
        lastMessageAt: new Date(),
      });
    }
  }

  // ✅ Save the user message
  await appendMessage({
    conversationId: convo._id,
    userId,
    role: "user",
    content: userMessage,
    documentText: extraContext || "",
  });

  // Load recent messages
  const recentMsgs = await loadRecentMessages({
    conversationId: convo._id,
    userId,
    limit: historyLimit,
  });

  const historyText = buildHistoryText(recentMsgs, convo.summary || "");
  const isConversational = Boolean(historyText && historyText.trim());
  const cacheKey = `answer::${country}::${userMessage}::${extraContext.slice(0, 200)}`;

  if (!isConversational) {
    const cached = await redis.get(cacheKey);
    if (cached) return typeof cached === "string" ? JSON.parse(cached) : cached;
  }

  // Embeddings & RAG
  let vector;
  const collection = `legal_chunks_${country.toLowerCase()}-gm`;

  try {
    vector = await geminiLLM.getEmbedding(userMessage);
  } catch (err) {
    console.error(`❌ Embedding failed with Gemini: ${err.message}`);
    throw err;
  }

  const results = await qdrant.search(collection, {
    vector,
    top: 5,
    with_payload: true,
  });

  const contextChunks = results.map((r) => r.payload.text);
  const ragContext = contextChunks.join("\n\n");

  const sources = [...new Set(results.map((r) => r.payload.source).filter(Boolean))];

  const systemPrompt = `You are a legal assistant providing information based on ${country.toUpperCase()}'s laws.
Use the provided context to answer the user's question clearly and accurately.`;

  const fullContext =
    (historyText ? `CONVERSATION HISTORY:\n${historyText}\n\n` : "") +
    (extraContext ? `UPLOADED DOCUMENT TEXT:\n${extraContext}\n\n` : "") +
    `LEGAL CONTEXT:\n${ragContext}`;

  try {
    const answer = await geminiLLM.getAnswer(userMessage, fullContext, systemPrompt);

    const response = {
      answer,
      sources,
      conversationId: String(convo._id),
      title: convo.title,
    };

    if (!isConversational) {
      await redis.set(cacheKey, JSON.stringify(response), { ex: CACHE_TTL });
    }

    // Save assistant message
    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "assistant",
      content: answer,
      sources,
      clauseAnalysis: clauseAnalysis ?? null,
      documentText: extraContext || "",
    });

    return response;
  } catch (err) {
    console.error(`❌ LLM response failed with Gemini: ${err.message}`);
    throw err;
  }
}