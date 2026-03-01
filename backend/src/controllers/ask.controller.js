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
    const query = req.body.query;
    const extraContext = req.body.extraContext || "";

    // ✅ Get user ID from passport session
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: "User must be logged in." });
    }

    const response = await getRAGAnswer(query, "nigeria", extraContext, {
      userId,                // <-- critical
      conversationId: req.body.conversationId || null,
    });

    res.json(response);
  } catch (err) {
    console.error("❌ Controller Error:", err);
    res.status(500).json({ error: err.message });
  }
}