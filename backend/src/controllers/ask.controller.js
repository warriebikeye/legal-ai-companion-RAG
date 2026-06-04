import { ExtractionService } from "../services/extraction.service.js";
import { ClauseCheckerService } from "../services/clauseChecker.service.js";
import { ingestionQueue } from "../queue/ingestion.queue.js";
import { ingestionQueueEvents } from "../queue/queueEvents.js";
import { getRAGAnswer } from "../services/rag.service.js";
import { checkQueueCapacity } from "../services/queueMonitor.service.js";
import {
  getOrCreateConversation,
  appendMessage,
  loadRecentMessages,
} from "../services/conversation.service.js";

const extractor = new ExtractionService();
const clauseChecker = new ClauseCheckerService();

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[TEXT_CONTROLLER] [${timestamp}] ${step}`, data)
    : console.log(`[TEXT_CONTROLLER] [${timestamp}] ${step}`);
}

function buildHistoryText(messages, summary = "") {
  const lines = messages.map((m) => {
    const who = m.role === "user" ? "User" : "Assistant";
    return `${who}: ${m.content}`;
  });

  if (summary?.trim()) {
    return `SUMMARY SO FAR:\n${summary}\n\nRECENT MESSAGES:\n${lines.join("\n")}`;
  }

  return lines.join("\n");
}

export async function handleTextQuery(req, res) {
  const start = Date.now();

  try {
    log("========================================");
    log("NEW REQUEST STARTED");

    /* =========================================================
       INPUTS
    ========================================================= */

    const query = req.body.query?.trim() || "";
    const country = (req.body.country || "nigeria").toLowerCase();
    const conversationIdFromClient = req.body.conversationId || null;
    const files = req.files || [];
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!query && !files.length) {
      return res.status(400).json({ error: "Query or file is required" });
    }

    log("Request received", { queryLength: query.length, fileCount: files.length, country });

    /* =========================================================
       BACKPRESSURE PROTECTION
    ========================================================= */

    const queueStatus = await checkQueueCapacity();

    if (queueStatus.overloaded) {
      log("⚠️ Queue overloaded", { stats: queueStatus.stats });
      return res.status(503).json({
        error: "System is under heavy load. Please try again shortly.",
        retryAfter: 30,
        ...(process.env.NODE_ENV === "development" && { queueStats: queueStatus.stats }),
      });
    }

    /* =========================================================
       CONVERSATION — CREATE OR LOAD
    ========================================================= */

    const convo = await getOrCreateConversation({
      conversationId: conversationIdFromClient,
      userId,
      country,
      title: query || "Document Chat",
    });

    log("Conversation ready", { conversationId: convo._id });

    /* =========================================================
       STEP 1 — FILE EXTRACTION + CLAUSE CHECK
    ========================================================= */

    let extractedText = "";
    let clauseAnalysis = null;

    if (files.length > 0) {
  log("Processing uploaded files");

  // Queue ingestion for vector storage (worker handles extraction + embedding)
  const job = await ingestionQueue.add("process-upload", {
    files: files.map((f) => ({
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      buffer: f.buffer ? f.buffer.toString("base64") : null,
    })),
    userId,
    conversationId: convo._id.toString(),
  });

  // Extract raw text for immediate RAG context + clause checking
  // Uses buffer methods directly — no disk path needed (memoryStorage)
  for (const file of files) {
    let text = "";

    if (file.mimetype === "application/pdf") {
      text = await extractor.extractFromPDF(file.buffer);
    } else if (file.mimetype.startsWith("text/")) {
      text = await extractor.extractFromTXT(file.buffer);
    } else if (file.mimetype.startsWith("image/")) {
      text = await extractor.extractFromImage(file.buffer);
    } else {
      console.warn(`Unsupported file: ${file.originalname}`);
    }

    extractedText += text + "\n\n";
  }

  extractedText = extractedText.trim();

  // Run clause check if text was extracted
  if (extractedText.trim()) {
    log("Running clause checker");
    try {
      clauseAnalysis = await clauseChecker.checkIllegalClauses(extractedText, country);
      log("Clause check done", { hasIssues: !!clauseAnalysis });
    } catch (clauseErr) {
      console.warn("⚠️ Clause checker failed (non-fatal):", clauseErr.message);
    }
  }

  // Wait for vector ingestion so RAG can retrieve it
  log("Waiting for vector ingestion");
  await job.waitUntilFinished(ingestionQueueEvents);
  log("Vector ingestion complete");
}
    /* =========================================================
       STEP 2 — LOAD CONVERSATION HISTORY
    ========================================================= */

    const recentMessages = await loadRecentMessages({
      conversationId: convo._id,
      userId,
      limit: 12,
    });

    const historyText = buildHistoryText(recentMessages, convo.summary || "");

    log("History loaded", { messageCount: recentMessages.length });

    /* =========================================================
       STEP 3 — SAVE USER MESSAGE
    ========================================================= */

    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "user",
      content: query || `[Uploaded: ${files.map((f) => f.originalname).join(", ")}]`,
      documentText: extractedText,
    });

    log("User message saved");

    /* =========================================================
       STEP 4 — RAG
    ========================================================= */

    log("Calling RAG service");

    const ragResponse = await getRAGAnswer(query, country, extractedText, {
      userId,
      conversationId: convo._id,
      historyText, // ✅ passed in, not fetched inside RAG
    });

    log("RAG completed", {
      hasAnswer: !!ragResponse?.answer,
      sources: ragResponse?.sources?.length || 0,
    });

    /* =========================================================
       STEP 5 — SAVE ASSISTANT MESSAGE
    ========================================================= */

    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "assistant",
      content: ragResponse.answer,
      sources: ragResponse.sources || [],
      clauseAnalysis: clauseAnalysis ?? null,
      documentText: "",
    });

    log("Assistant message saved");

    /* =========================================================
       RESPONSE
    ========================================================= */

    const duration = Date.now() - start;
    log("REQUEST COMPLETED", { durationMs: duration });

    return res.json({
      answer: ragResponse.answer,
      sources: ragResponse.sources || [],
      clauseAnalysis: clauseAnalysis ?? null,
      documentMode: ragResponse.documentMode || null,
      conversationId: convo._id.toString(),
      modelUsed: ragResponse.modelUsed || null,
      latencyMs: ragResponse.latencyMs || null,
      durationMs: duration,
    });

  } catch (err) {
    console.error("❌ CONTROLLER ERROR:", { message: err?.message, stack: err?.stack });
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}