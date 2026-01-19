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

function buildHistoryText(messages) {
  return messages
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
}
/**
 * Handles legal text queries with optional file uploads.
 * Accepts multipart/form-data:
 *   - query (string)
 *   - country (string)
 *   - files[] (pdf/images/etc.)
 */
export async function handleTextQuery(req, res) {
  try {
    const userId = req.user?._id; // ✅ from passport
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const query = req.body.query;
    const country = (req.body.country || "nigeria").toLowerCase();
    const conversationIdFromClient = req.body.conversationId || null;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: "Query is required" });
    }

    // ✅ create or load conversation
    const convo = await getOrCreateConversation({
      conversationId: conversationIdFromClient,
      userId,
      country,
    });

    let extractedText = "";
    let clauseAnalysis = null;

    if (req.files && req.files.length > 0) {
      extractedText = await extractor.extract(req.files);

      if (extractedText.trim()) {
        clauseAnalysis = await clauseChecker.checkIllegalClauses(extractedText, country);
      }
    }

    // ✅ save user message
    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "user",
      content: query,
      documentText: extractedText || "",
    });

    // ✅ load last messages for history
    const recentMsgs = await loadRecentMessages({
      conversationId: convo._id,
      userId,
      limit: 12,
    });

    const historyText = buildHistoryText(recentMsgs);

    // ✅ ask RAG with history
    const ragResponse = await getRAGAnswer(query, country, extractedText, historyText);

    const answer = ragResponse?.answer || "No answer generated.";
    const sources = ragResponse?.sources || [];

    // ✅ save assistant response
    await appendMessage({
      conversationId: convo._id,
      userId,
      role: "assistant",
      content: answer,
      sources,
      clauseAnalysis: clauseAnalysis || null,
      documentText: extractedText || "",
    });

    return res.json({
      success: true,
      conversationId: String(convo._id),
      answer,
      sources,
      documentText: extractedText || null,
      clauseAnalysis: clauseAnalysis || null,
    });
  } catch (err) {
    console.error("❌ Controller Error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
