import { ExtractionService } from "../services/extraction.service.js";
import { ClauseCheckerService } from "../services/clauseChecker.service.js";
import { getRAGAnswer } from "../services/rag.service.js";

const extractor = new ExtractionService();
const clauseChecker = new ClauseCheckerService();

/**
 * Handles legal text queries with optional file uploads.
 * Accepts multipart/form-data:
 *   - query (string)
 *   - country (string)
 *   - files[] (pdf/images/etc.)
 */
export async function handleTextQuery(req, res) {
  try {
    // Because of multer, req.body contains the fields
    const query = req.body.query;
    const country = (req.body.country || "nigeria").toLowerCase();

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: "Query is required" });
    }

    let extractedText = "";
    let clauseAnalysis = null;

    // Handle uploaded files (if any)
    if (req.files && req.files.length > 0) {
      try {
        extractedText = await extractor.extract(req.files);

        if (extractedText && extractedText.trim().length > 0) {
          clauseAnalysis = await clauseChecker.checkIllegalClauses(
            extractedText,
            country
          );
        }
      } catch (fileErr) {
        console.error("❌ File extraction error:", fileErr);
        return res.status(500).json({
          error: "Failed to extract text from uploaded files",
          details: fileErr.message,
        });
      }
    }

    // Get the RAG-generated answer
    const ragResponse = await getRAGAnswer(query, country, extractedText);

    // Ensure RAG returns structured output
    const answer = ragResponse?.answer || "No answer generated.";
    const sources = ragResponse?.sources || [];

    return res.json({
      success: true,
      answer,
      sources,
      documentText: extractedText || null,
      clauseAnalysis: clauseAnalysis || null,
    });

  } catch (err) {
    console.error("❌ Controller Error:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
}
