import { ExtractionService } from "../services/extraction.service.js";
import { ClauseCheckerService } from "../services/clauseChecker.service.js";
import { getRAGAnswer } from "../services/rag.service.js";
import {
  getOrCreateConversation,
  appendMessage,
  loadRecentMessages,
} from "../services/conversation.service.js";

const extractor = new ExtractionService();
const clauseChecker = new ClauseCheckerService();

/* =========================================================
   Simple Controller Logger
========================================================= */
function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[TEXT_CONTROLLER] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[TEXT_CONTROLLER] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   Build History Text
========================================================= */
function buildHistoryText(messages) {
  return messages
    .map(
      (m) =>
        `${m.role === "user" ? "User" : "Assistant"}: ${
          m.content
        }`
    )
    .join("\n");
}

/* =========================================================
   Handle Legal Text Query
========================================================= */
export async function handleTextQuery(req, res) {
  const requestStarted = Date.now();

  try {
    log("=========================================");
    log("NEW TEXT QUERY REQUEST STARTED");

    /* =========================================================
       Request Data
    ========================================================= */

    const query = req.body.query;
    const extraContext =
      req.body.extraContext || "";

    const conversationId =
      req.body.conversationId || null;

    log("Incoming request body", {
      hasQuery: !!query,
      queryLength: query?.length || 0,
      queryPreview: query?.slice(0, 120),
      extraContextLength:
        extraContext?.length || 0,
      conversationId,
    });

    /* =========================================================
       Auth Validation
    ========================================================= */

    const userId = req.user?._id;

    if (!userId) {
      log("❌ Unauthorized request");

      return res.status(401).json({
        error: "User must be logged in.",
      });
    }

    log("Authenticated user", {
      userId: String(userId),
    });

    /* =========================================================
       Calling RAG Service
    ========================================================= */

    log("Calling getRAGAnswer service");

    const response = await getRAGAnswer(
      query,
      "nigeria",
      extraContext,
      {
        userId,
        conversationId,
      }
    );

    log("✅ RAG service completed", {
      hasAnswer: !!response?.answer,
      answerLength:
        response?.answer?.length || 0,
      sourceCount:
        response?.sources?.length || 0,
      responseConversationId:
        response?.conversationId,
    });

    const totalDuration =
      Date.now() - requestStarted;

    log("✅ REQUEST COMPLETED SUCCESSFULLY", {
      durationMs: totalDuration,
    });

    log("=========================================");

    return res.json(response);
  } catch (err) {
    console.error(
      "❌ TEXT CONTROLLER ERROR:",
      {
        message: err?.message,
        stack: err?.stack,
        body: req.body,
        userId: req.user?._id || null,
      }
    );

    return res.status(500).json({
      error:
        err?.message ||
        "Internal server error",
    });
  }
}