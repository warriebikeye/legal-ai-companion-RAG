import { ExtractionService } from "../services/extraction.service.js";
import { ClauseCheckerService } from "../services/clauseChecker.service.js";
import { getRAGAnswer } from "../services/rag.service.js";

const extractor = new ExtractionService();
const clauseChecker = new ClauseCheckerService();

export async function handleTextQuery(req, res) {
  try {
    const { query, country = "nigeria" } = req.body;

    // Query is required, but files are optional
    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    let extractedText = "";
    let clauseAnalysis = null;

    // Extract only if files exist
    if (req.files && req.files.length > 0) {
      extractedText = await extractor.extract(req.files);

      if (extractedText.trim().length > 0) {
        clauseAnalysis = await clauseChecker.checkIllegalClauses(extractedText, country);
      }
    }

    // RAG Answer (merge query + optional file context)
    const { answer, sources } =
      await getRAGAnswer(query, country.toLowerCase(), extractedText);

    return res.json({
      answer,
      sources,
      documentText: extractedText || null,
      clauseAnalysis: clauseAnalysis || null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
}
