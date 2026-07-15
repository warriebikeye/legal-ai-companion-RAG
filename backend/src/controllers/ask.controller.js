// src/controllers/text.controller.js
//
// Adds a streaming SSE variant: handleTextQueryStream()
// The original handleTextQuery() is kept intact for non-streaming clients.
//
// Route wiring (in ask.js or equivalent):
//   router.post("/stream", isAuthenticated, upload.array("files"), handleTextQueryStream);
//   router.post("/",       isAuthenticated, upload.array("files"), handleTextQuery);

import { ExtractionService } from "../services/extraction.service.js";
import { ClauseCheckerService } from "../services/clauseChecker.service.js";
import { ingestionQueue } from "../queue/ingestion.queue.js";
import { ingestionQueueEvents } from "../queue/queueEvents.js";
import { getRAGAnswer, getRAGAnswerStream } from "../services/rag.service.js";
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

/* =========================================================
   SHARED — file extraction + ingestion
   Used by both blocking and streaming handlers.
========================================================= */

async function processFiles({ files, userId, conversationId, country }) {
  if (!files.length) return { extractedText: "", clauseAnalysis: null };

  log("Processing uploaded files");

  const job = await ingestionQueue.add("process-upload", {
    files: files.map((f) => ({
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      buffer: f.buffer ? f.buffer.toString("base64") : null,
    })),
    userId,
    conversationId: conversationId.toString(),
  });

  let extractedText = "";
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

  let clauseAnalysis = null;
  if (extractedText) {
    log("Running clause checker");
    try {
      clauseAnalysis = await clauseChecker.checkIllegalClauses(extractedText, country);
      log("Clause check done", { hasIssues: !!clauseAnalysis });
    } catch (clauseErr) {
      console.warn("⚠️ Clause checker failed (non-fatal):", clauseErr.message);
    }
  }

  log("Waiting for vector ingestion");
  await job.waitUntilFinished(ingestionQueueEvents);
  log("Vector ingestion complete");

  return { extractedText, clauseAnalysis };
}

/* =========================================================
   BLOCKING handler — original, untouched
========================================================= */

export async function handleTextQuery(req, res) {
  const start = Date.now();

  try {
    log("========================================");
    log("NEW REQUEST STARTED");

    const query = req.body.query?.trim() || "";
    const country = (req.body.country || "nigeria").toLowerCase();
    const conversationIdFromClient = req.body.conversationId || null;
    const files = req.files || [];
    const userId = req.user?._id;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!query && !files.length) return res.status(400).json({ error: "Query or file is required" });

    log("Request received", { queryLength: query.length, fileCount: files.length, country });

    const queueStatus = await checkQueueCapacity();
    if (queueStatus.overloaded) {
      log("⚠️ Queue overloaded", { stats: queueStatus.stats });
      return res.status(503).json({
        error: "System is under heavy load. Please try again shortly.",
        retryAfter: 30,
        ...(process.env.NODE_ENV === "development" && { queueStats: queueStatus.stats }),
      });
    }

    const convo = await getOrCreateConversation({
      conversationId: conversationIdFromClient,
      userId,
      country,
      title: query || "Document Chat",
    });

    log("Conversation ready", { conversationId: convo._id });

    const { extractedText, clauseAnalysis } = await processFiles({
      files,
      userId,
      conversationId: convo._id,
      country,
    });

    const recentMessages = await loadRecentMessages({ conversationId: convo._id, userId, limit: 12 });
    const historyText = buildHistoryText(recentMessages, convo.summary || "");

    log("History loaded", { messageCount: recentMessages.length });

    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "user",
      content: query || `[Uploaded: ${files.map((f) => f.originalname).join(", ")}]`,
      documentText: extractedText,
    });

    log("User message saved");
    log("Calling RAG service");

    const ragResponse = await getRAGAnswer(query, country, extractedText, {
      userId,
      conversationId: convo._id,
      historyText,
    });

    log("RAG completed", { hasAnswer: !!ragResponse?.answer, sources: ragResponse?.sources?.length || 0 });

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

    const duration = Date.now() - start;
    log("REQUEST COMPLETED", { durationMs: duration });

    return res.json({
      answer: ragResponse.answer,
      sources: ragResponse.sources || [],
      clauseAnalysis: clauseAnalysis ?? null,
      documentText: extractedText || null,
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

/* =========================================================
   STREAMING handler — SSE
   
   Event stream format (NDJSON over SSE):
   
     data: {"type":"connected","payload":{"conversationId":"..."}}
     data: {"type":"meta","payload":{"sources":[...],"documentMode":"..."}}
     data: {"type":"chunk","payload":"...text token..."}
     data: {"type":"clause","payload":{...clauseAnalysis}}
     data: {"type":"done","payload":{"durationMs":1420,"modelUsed":"gemini-2.5-flash"}}
     data: {"type":"error","payload":"Something went wrong"}

   Client usage:
     const es = new EventSource("/ask/stream?...");  // GET with params
     // OR POST via fetch with ReadableStream — see frontend hook below.
========================================================= */

export async function handleTextQueryStream(req, res) {
  const start = Date.now();

  log("========================================");
  log("NEW STREAM REQUEST STARTED");

  /* -------------------------------------------------------
     SSE HEADERS
     Must be set before any async work so the client
     gets the connection event immediately.
  ------------------------------------------------------- */

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering
  res.flushHeaders();

  // Helper: write a typed SSE event
  const send = (type, payload) => {
    try {
      res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
    } catch {
      // Client disconnected — swallow
    }
  };

  // Keep-alive ping every 20s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 20000);

  // Clean up on client disconnect
  req.on("close", () => {
    clearInterval(keepAlive);
    log("Client disconnected from stream");
  });

  try {
    /* -------------------------------------------------------
       INPUTS
    ------------------------------------------------------- */

    const query = req.body.query?.trim() || "";
    const country = (req.body.country || "nigeria").toLowerCase();
    const conversationIdFromClient = req.body.conversationId || null;
    const files = req.files || [];
    const userId = req.user?._id;

    if (!userId) {
      send("error", "Unauthorized");
      return res.end();
    }

    if (!query && !files.length) {
      send("error", "Query or file is required");
      return res.end();
    }

    log("Stream request received", { queryLength: query.length, fileCount: files.length, country });

    /* -------------------------------------------------------
       BACKPRESSURE CHECK
    ------------------------------------------------------- */

    const queueStatus = await checkQueueCapacity();
    if (queueStatus.overloaded) {
      log("⚠️ Queue overloaded");
      send("error", "System is under heavy load. Please try again shortly.");
      return res.end();
    }

    /* -------------------------------------------------------
       CONVERSATION
    ------------------------------------------------------- */

    const convo = await getOrCreateConversation({
      conversationId: conversationIdFromClient,
      userId,
      country,
      title: query || "Document Chat",
    });

    // Immediately confirm connection with conversationId
    send("connected", { conversationId: convo._id.toString() });

    log("Conversation ready", { conversationId: convo._id });

    /* -------------------------------------------------------
       FILE PROCESSING (if any)
       Happens before streaming so the vector store is ready.
    ------------------------------------------------------- */

    const { extractedText, clauseAnalysis } = await processFiles({
      files,
      userId,
      conversationId: convo._id,
      country,
    });

    /* -------------------------------------------------------
       CONVERSATION HISTORY
    ------------------------------------------------------- */

    const recentMessages = await loadRecentMessages({
      conversationId: convo._id,
      userId,
      limit: 12,
    });
    const historyText = buildHistoryText(recentMessages, convo.summary || "");

    log("History loaded", { messageCount: recentMessages.length });

    /* -------------------------------------------------------
       SAVE USER MESSAGE
    ------------------------------------------------------- */

    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "user",
      content: query || `[Uploaded: ${files.map((f) => f.originalname).join(", ")}]`,
      documentText: extractedText,
    });

    log("User message saved");

    /* -------------------------------------------------------
       STREAM RAG RESPONSE
    ------------------------------------------------------- */

    log("Starting RAG stream");

    let fullAnswer = "";
    let metaPayload = null;
    let donePayload = null;

    const ragStream = getRAGAnswerStream(query, country, extractedText, {
      userId,
      conversationId: convo._id,
      historyText,
    });

    for await (const event of ragStream) {
      if (event.type === "meta") {
        metaPayload = event.payload;
        send("meta", {
          ...event.payload,
          documentText: extractedText || null,
          documentTruncated: clauseAnalysis?.truncated || false,
        });

      } else if (event.type === "chunk") {
        fullAnswer += event.payload;
        send("chunk", event.payload);

      } else if (event.type === "done") {
        donePayload = event.payload;

        // Emit clause analysis before done (if any)
        if (clauseAnalysis) {
          send("clause", clauseAnalysis);
        }

        send("done", {
          ...event.payload,
          durationMs: Date.now() - start,
        });

      } else if (event.type === "error") {
        send("error", event.payload);
        clearInterval(keepAlive);
        return res.end();
      }
    }

    /* -------------------------------------------------------
       SAVE ASSISTANT MESSAGE (after stream completes)
    ------------------------------------------------------- */

    if (fullAnswer) {
      await appendMessage({
        conversationId: convo._id,
        userId,
        role: "assistant",
        content: fullAnswer,
        sources: metaPayload?.sources || [],
        clauseAnalysis: clauseAnalysis ?? null,
        documentText: "",
      });
      log("Assistant message saved", { length: fullAnswer.length });
    }

    log("STREAM REQUEST COMPLETED", { durationMs: Date.now() - start });

  } catch (err) {
    console.error("❌ STREAM CONTROLLER ERROR:", { message: err?.message, stack: err?.stack });
    send("error", err?.message || "Internal server error");
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
}