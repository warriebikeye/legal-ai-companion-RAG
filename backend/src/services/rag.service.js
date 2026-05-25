// src/services/rag.service.js

import { qdrant } from "../vectorstore/qdrant.js";
import redis from "./redis.js";
import * as geminiLLM from "../llm/gemini.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

const CACHE_TTL = 60 * 60; // 1 hour
const EMBEDDING_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days

const MAX_HISTORY_MESSAGES = 4;

/* =========================================================
   Retrieval tuning
========================================================= */

const SIMILARITY_THRESHOLD = 0.55;
const TOP_K_RESULTS = 5;

const MAX_CONTEXT_CHUNK_LENGTH = 1200;
const MAX_EXTRA_CONTEXT_LENGTH = 2000;

/* =========================================================
   Simple logger
========================================================= */
function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[RAG] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[RAG] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   Normalize query for better cache hits
========================================================= */
function normalizeQuery(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   Lightweight small-talk detector
========================================================= */
function isSmallTalk(text = "") {
  const normalized = normalizeQuery(text);

  const smallTalks = [
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "thanks",
    "thank you",
    "how are you",
  ];

  return smallTalks.includes(normalized);
}

/* =========================================================
   Build compact history
========================================================= */
function buildHistoryText(
  messages,
  summary = ""
) {
  const lines = messages.map((m) => {
    const who =
      m.role === "user"
        ? "User"
        : m.role === "assistant"
        ? "Assistant"
        : "System";

    return `${who}: ${m.content}`;
  });

  if (summary && summary.trim()) {
    return `SUMMARY SO FAR:
${summary}

RECENT MESSAGES:
${lines.join("\n")}`;
  }

  return lines.join("\n");
}

/* =========================================================
   Compress large context
========================================================= */
function compressContext(
  text = "",
  maxLength = 4000
) {
  if (!text) return "";

  return text.length > maxLength
    ? text.slice(0, maxLength)
    : text;
}

/* =========================================================
   Save message
========================================================= */
async function appendMessage({
  conversationId,
  userId,
  role,
  content,
  sources = [],
  clauseAnalysis = null,
  documentText = "",
}) {
  try {
    log("Saving message", {
      role,
      conversationId:
        String(conversationId),
    });

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
      {
        _id: conversationId,
        userId,
      },
      {
        $set: {
          lastMessageAt: new Date(),
        },
      }
    );

    log("Message saved successfully");

    return msg;
  } catch (err) {
    console.error(
      "❌ Failed to save message:",
      err
    );

    throw err;
  }
}

/* =========================================================
   Load recent messages
========================================================= */
async function loadRecentMessages({
  conversationId,
  userId,
  limit = MAX_HISTORY_MESSAGES,
}) {
  try {
    log("Loading recent messages", {
      conversationId:
        String(conversationId),
      limit,
    });

    const msgs = await Message.find({
      conversationId,
      userId,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    log("Recent messages loaded", {
      count: msgs.length,
    });

    return msgs.reverse();
  } catch (err) {
    console.error(
      "❌ Failed to load recent messages:",
      err
    );

    throw err;
  }
}

/* =========================================================
   Main RAG Service
========================================================= */
export async function getRAGAnswer(
  query,
  country = "nigeria",
  extraContext = "",
  options = {}
) {
  const requestStarted = Date.now();

  try {
    log(
      "================================================="
    );

    log("NEW RAG REQUEST STARTED");

    const {
      userId = null,
      conversationId = null,
      userMessageOverride = null,
      clauseAnalysis = null,
    } = options;

    if (!userId) {
      throw new Error(
        "UserId is required for conversation."
      );
    }

    /* =========================================================
       Validate input
    ========================================================= */

    const userMessage = (
      userMessageOverride ||
      query ||
      ""
    ).trim();

    if (!userMessage) {
      throw new Error(
        "Cannot create conversation with empty message."
      );
    }

    log("Incoming question", {
      question: userMessage,
      country,
      userId,
      conversationId,
    });

    const normalizedQuery =
      normalizeQuery(userMessage);

    log("Normalized query", {
      normalizedQuery,
    });

    /* =========================================================
       Small talk bypass
    ========================================================= */

    if (isSmallTalk(userMessage)) {
      log(
        "Small-talk detected → bypassing RAG"
      );

      return {
        answer:
          "Hello! How can I assist you with legal questions today?",
        sources: [],
        conversationId: null,
        title: "Legal Assistant",
      };
    }

    /* =========================================================
       Create / Load Conversation
    ========================================================= */

    let convo = null;

    if (!conversationId) {
      log("Creating new conversation");

      convo = await Conversation.create({
        userId,
        country:
          (
            country || "nigeria"
          ).toLowerCase(),

        title: userMessage.slice(
          0,
          100
        ),

        summary: "",

        lastMessageAt: new Date(),
      });

      log(
        "New conversation created",
        {
          conversationId: String(
            convo._id
          ),
        }
      );
    } else {
      log(
        "Loading existing conversation",
        {
          conversationId,
        }
      );

      convo =
        await Conversation.findOne({
          _id: conversationId,
          userId,
        });

      if (!convo) {
        log(
          "Conversation not found → creating fallback"
        );

        convo =
          await Conversation.create({
            userId,

            country:
              (
                country ||
                "nigeria"
              ).toLowerCase(),

            title:
              userMessage.slice(
                0,
                100
              ),

            summary: "",

            lastMessageAt:
              new Date(),
          });

        log(
          "Fallback conversation created",
          {
            conversationId:
              String(
                convo._id
              ),
          }
        );
      } else {
        log(
          "Conversation loaded successfully"
        );
      }
    }

    /* =========================================================
       Load history BEFORE save
    ========================================================= */

    const recentMsgsBeforeSave =
      await loadRecentMessages({
        conversationId:
          convo._id,

        userId,

        limit:
          MAX_HISTORY_MESSAGES,
      });

    const shouldUseCache =
      recentMsgsBeforeSave.length <= 2;

    log("Cache decision", {
      shouldUseCache,
      previousMessageCount:
        recentMsgsBeforeSave.length,
    });

    /* =========================================================
       Response cache check
    ========================================================= */

    const cacheKey = `answer::${country.toLowerCase()}::${normalizedQuery}`;

    if (shouldUseCache) {
      log("Checking response cache", {
        cacheKey,
      });

      const cached =
        await redis.get(cacheKey);

      if (cached) {
        log("✅ RESPONSE CACHE HIT");

        const parsed =
          typeof cached === "string"
            ? JSON.parse(cached)
            : cached;

        return {
          ...parsed,
          conversationId: String(
            convo._id
          ),
          title: convo.title,
        };
      }

      log("❌ RESPONSE CACHE MISS");
    }

    /* =========================================================
       Save user message
    ========================================================= */

    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "user",
      content: userMessage,
      documentText:
        extraContext || "",
    });

    /* =========================================================
       Load compact history
    ========================================================= */

    const recentMsgs =
      await loadRecentMessages({
        conversationId:
          convo._id,

        userId,

        limit:
          MAX_HISTORY_MESSAGES,
      });

    const historyText =
      buildHistoryText(
        recentMsgs,
        convo.summary || ""
      );

    log("History prepared", {
      historyLength:
        historyText.length,

      recentMessages:
        recentMsgs.length,
    });

    /* =========================================================
       Embedding cache
    ========================================================= */

    let vector;

    const embeddingCacheKey = `embedding::${normalizedQuery}`;

    log("Checking embedding cache", {
      embeddingCacheKey,
    });

    const cachedEmbedding =
      await redis.get(
        embeddingCacheKey
      );

    if (cachedEmbedding) {
      log("✅ EMBEDDING CACHE HIT");

      vector =
        typeof cachedEmbedding ===
        "string"
          ? JSON.parse(
              cachedEmbedding
            )
          : cachedEmbedding;
    } else {
      log("❌ EMBEDDING CACHE MISS");

      try {
        log(
          "Generating embedding with Gemini"
        );

        vector =
          await geminiLLM.getEmbedding(
            normalizedQuery
          );

        log(
          "Embedding generated successfully"
        );

        await redis.set(
          embeddingCacheKey,
          JSON.stringify(vector),
          {
            ex:
              EMBEDDING_CACHE_TTL,
          }
        );

        log(
          "Embedding cached successfully"
        );
      } catch (err) {
        console.error(
          "❌ Embedding failed with Gemini:",
          err
        );

        throw err;
      }
    }

    /* =========================================================
       Vector Search
    ========================================================= */

    const collection = `legal_chunks_${country.toLowerCase()}-gm`;

    log("Starting Qdrant vector search", {
      collection,
      topK: TOP_K_RESULTS,
    });

    const results =
      await qdrant.search(collection, {
        vector,
        top: TOP_K_RESULTS,
        with_payload: true,
      });

    log("Qdrant search completed", {
      resultCount:
        results.length,

      topScore:
        results?.[0]?.score || 0,
    });

    log(
      "Search scores",
      results.map((r) => ({
        score: r.score,
        source:
          r.payload?.source ||
          "unknown",
      }))
    );

    /* =========================================================
       Filter by threshold
    ========================================================= */

    const filteredResults =
      results.filter(
        (r) =>
          r.score >=
          SIMILARITY_THRESHOLD
      );

    log("Filtered results", {
      originalCount:
        results.length,

      filteredCount:
        filteredResults.length,

      threshold:
        SIMILARITY_THRESHOLD,
    });

    if (!filteredResults.length) {
      log(
        "❌ No relevant legal matches found"
      );

      return {
        answer:
          "I could not find sufficient legal context to answer this question accurately.",

        sources: [],

        conversationId: String(
          convo._id
        ),

        title: convo.title,
      };
    }

    log(
      "✅ Relevant legal matches found"
    );

    /* =========================================================
       Build compressed context
    ========================================================= */

    const contextChunks =
      filteredResults
        .map(
          (r) =>
            r.payload?.text || ""
        )
        .filter(Boolean)
        .map((chunk) =>
          compressContext(
            chunk,
            MAX_CONTEXT_CHUNK_LENGTH
          )
        );

    const ragContext =
      contextChunks.join("\n\n");

    const compressedExtraContext =
      compressContext(
        extraContext,
        MAX_EXTRA_CONTEXT_LENGTH
      );

    const sources = [
      ...new Set(
        filteredResults
          .map(
            (r) =>
              r.payload?.source
          )
          .filter(Boolean)
      ),
    ];

    log("RAG context prepared", {
      chunkCount:
        contextChunks.length,

      ragContextLength:
        ragContext.length,

      sourceCount:
        sources.length,
    });

    /* =========================================================
       System prompt
    ========================================================= */

    const systemPrompt = `
You are a legal assistant providing information based on ${country.toUpperCase()}'s laws.

Rules:
- Answer clearly and accurately.
- Use only the provided legal context.
- If legal context is insufficient, say so.
- Keep answers concise and practical.
- Explain legal concepts in simple language.
`;

    /* =========================================================
       Prompt construction
    ========================================================= */

    const fullContext =
      (historyText
        ? `CONVERSATION HISTORY:
${historyText}

`
        : "") +
      (compressedExtraContext
        ? `UPLOADED DOCUMENT TEXT:
${compressedExtraContext}

`
        : "") +
      `LEGAL CONTEXT:
${ragContext}`;

    log("Full prompt prepared", {
      contextLength:
        fullContext.length,
    });

    /* =========================================================
       Generate answer
    ========================================================= */

    log("Calling Gemini for answer");

    const answer =
      await geminiLLM.getAnswer(
        userMessage,
        fullContext,
        systemPrompt
      );

    log("✅ Gemini answer generated", {
      answerLength:
        answer?.length || 0,
    });

    const response = {
      answer,
      sources,
      conversationId: String(
        convo._id
      ),
      title: convo.title,
    };

    /* =========================================================
       Cache final response
    ========================================================= */

    if (shouldUseCache) {
      log("Caching final response");

      await redis.set(
        cacheKey,
        JSON.stringify(response),
        {
          ex: CACHE_TTL,
        }
      );

      log(
        "Final response cached successfully"
      );
    }

    /* =========================================================
       Save assistant response
    ========================================================= */

    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "assistant",
      content: answer,
      sources,

      clauseAnalysis:
        clauseAnalysis ?? null,

      documentText:
        compressedExtraContext ||
        "",
    });

    /* =========================================================
       Conversation auto-summary
    ========================================================= */

    const totalMessages =
      await Message.countDocuments({
        conversationId: convo._id,
        userId,
      });

    log("Conversation stats", {
      totalMessages,
    });

    if (totalMessages % 10 === 0) {
      try {
        log(
          "Generating conversation summary"
        );

        const summaryPrompt = `
Summarize this legal conversation in less than 200 words.

${historyText}
`;

        const summary =
          await geminiLLM.getAnswer(
            "Summarize conversation",
            summaryPrompt,
            "You are a legal conversation summarizer."
          );

        await Conversation.updateOne(
          {
            _id: convo._id,
            userId,
          },
          {
            $set: {
              summary,
            },
          }
        );

        log(
          "✅ Conversation summary updated"
        );
      } catch (summaryErr) {
        console.error(
          "❌ Conversation summary failed:",
          summaryErr
        );
      }
    }

    const totalDuration =
      Date.now() - requestStarted;

    log("✅ RAG REQUEST COMPLETED", {
      durationMs: totalDuration,
    });

    log(
      "================================================="
    );

    return response;
  } catch (err) {
    console.error(
      "❌ RAG SERVICE FAILED:",
      err
    );

    throw err;
  }
}