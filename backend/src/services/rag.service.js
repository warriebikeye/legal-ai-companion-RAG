// src/services/rag.service.js

import { qdrant } from "../vectorstore/qdrant.js";
import redis from "./redis.js";
import * as geminiLLM from "../llm/gemini.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";

const CACHE_TTL = 60 * 60; // 1 hour
const EMBEDDING_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days

/* =========================================================
   Tier-based configuration
========================================================= */

const FREE_CONFIG = {
  historyLimit: 4,
  topK: 3,
  maxChunkLength: 700,
  maxExtraContextLength: 1500,
  similarityThreshold: 0.58,
};

const PREMIUM_CONFIG = {
  historyLimit: 10,
  topK: 8,
  maxChunkLength: 1500,
  maxExtraContextLength: 6000,
  similarityThreshold: 0.50,
};

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
   Normalize query
========================================================= */

function normalizeQuery(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   Small talk detector
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
   Compress context
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

  if (summary?.trim()) {
    return `SUMMARY SO FAR:
${summary}

RECENT MESSAGES:
${lines.join("\n")}`;
  }

  return lines.join("\n");
}

/* =========================================================
   Detect complex request
========================================================= */

function isComplexRequest({
  query = "",
  extraContext = "",
}) {
  const combinedLength =
    query.length + extraContext.length;

  return (
    combinedLength > 6000 ||
    extraContext.length > 4000
  );
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
  modelUsed = null,
}) {
  try {
    log("Saving message", {
      role,
      conversationId:
        String(conversationId),
      modelUsed,
    });

    const msg = await Message.create({
      conversationId,
      userId,
      role,
      content,
      sources,
      clauseAnalysis,
      documentText,
      modelUsed,
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
  limit,
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
       Load user tier
    ========================================================= */

    const user =
      await User.findById(userId).lean();

    if (!user) {
      throw new Error(
        "User not found."
      );
    }

    const userTier =
      user.subscriptionTier || "free";

    const tierConfig =
      userTier === "premium"
        ? PREMIUM_CONFIG
        : FREE_CONFIG;

    log("User tier loaded", {
      userId,
      userTier,
      dailyPassActive:
        user.dailyPassActive,
    });

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

    const normalizedQuery =
      normalizeQuery(userMessage);

    log("Incoming question", {
      country,
      userTier,
      queryLength:
        userMessage.length,
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
        "Conversation created",
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
          "Conversation missing → creating fallback"
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
          tierConfig.historyLimit,
      });

    const shouldUseCache =
      recentMsgsBeforeSave.length <= 2;

    log("Cache decision", {
      shouldUseCache,
      previousMessages:
        recentMsgsBeforeSave.length,
    });

    /* =========================================================
       Cache key
    ========================================================= */

    const cacheKey = `answer::${userTier}::${country.toLowerCase()}::${normalizedQuery}`;

    /* =========================================================
       Response cache
    ========================================================= */

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
          cacheHit: true,
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
       Reload recent history
    ========================================================= */

    const recentMsgs =
      await loadRecentMessages({
        conversationId:
          convo._id,
        userId,
        limit:
          tierConfig.historyLimit,
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

      vector =
        await geminiLLM.getEmbedding(
          normalizedQuery
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
    }

    /* =========================================================
       Vector search
    ========================================================= */

    const collection = `legal_chunks_${country.toLowerCase()}-gm`;

    log("Starting vector search", {
      collection,
      topK: tierConfig.topK,
      similarityThreshold:
        tierConfig.similarityThreshold,
    });

    const results =
      await qdrant.search(collection, {
        vector,
        top: tierConfig.topK,
        with_payload: true,
      });

    log("Vector search completed", {
      resultCount:
        results.length,
      topScore:
        results?.[0]?.score || 0,
    });

    /* =========================================================
       Filter search results
    ========================================================= */

    const filteredResults =
      results.filter(
        (r) =>
          r.score >=
          tierConfig.similarityThreshold
      );

    log("Filtered results", {
      originalCount:
        results.length,
      filteredCount:
        filteredResults.length,
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

    /* =========================================================
       Build RAG context
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
            tierConfig.maxChunkLength
          )
        );

    const ragContext =
      contextChunks.join("\n\n");

    const compressedExtraContext =
      compressContext(
        extraContext,
        tierConfig.maxExtraContextLength
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
       Dynamic task routing
    ========================================================= */

    const complexRequest =
      isComplexRequest({
        query: userMessage,
        extraContext:
          compressedExtraContext,
      });

    const taskType =
      complexRequest
        ? "deep_reasoning"
        : "chat";

    log("Task routing decision", {
      complexRequest,
      taskType,
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
       Full context
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

    log("Prompt context prepared", {
      contextLength:
        fullContext.length,
    });

    /* =========================================================
       Generate answer
    ========================================================= */

    log("Calling Gemini");

    const {
      response: answer,
      modelUsed,
      latencyMs,
      fallbackUsed,
    } =
      await geminiLLM.getAnswer({
        query: userMessage,
        context: fullContext,
        systemPrompt,
        userTier,
        taskType,
      });

    log("Gemini response received", {
      modelUsed,
      latencyMs,
      fallbackUsed,
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
      modelUsed,
      latencyMs,
      fallbackUsed,
    };

    /* =========================================================
       Cache final response
    ========================================================= */

    if (shouldUseCache) {
      log("Caching response");

      await redis.set(
        cacheKey,
        JSON.stringify(response),
        {
          ex: CACHE_TTL,
        }
      );

      log(
        "Response cached successfully"
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
      clauseAnalysis,
      documentText:
        compressedExtraContext ||
        "",
      modelUsed,
    });

    /* =========================================================
       Conversation summary
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

        const {
          response: summary,
          modelUsed:
            summaryModel,
        } =
          await geminiLLM.getAnswer({
            query:
              "Summarize conversation",
            context: summaryPrompt,
            systemPrompt:
              "You are a legal conversation summarizer.",
            userTier,
            taskType: "summary",
          });

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
          "Conversation summary updated",
          {
            summaryModel,
          }
        );
      } catch (summaryErr) {
        console.error(
          "❌ Conversation summary failed:",
          summaryErr
        );
      }
    }

    /* =========================================================
       Request completed
    ========================================================= */

    const totalDuration =
      Date.now() - requestStarted;

    log("✅ RAG REQUEST COMPLETED", {
      durationMs: totalDuration,
      userTier,
      modelUsed,
    });

    log(
      "================================================="
    );

    return response;
  } catch (err) {
    console.error(
      "❌ RAG SERVICE FAILED:",
      {
        message: err?.message,
        stack: err?.stack,
      }
    );

    throw err;
  }
}