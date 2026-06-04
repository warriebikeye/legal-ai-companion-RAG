/* =========================================================
   LOGGER
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[INTENT_ROUTER] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[INTENT_ROUTER] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   NORMALIZE QUERY
========================================================= */

function normalize(text = "") {
  return text
    .toLowerCase()
    .trim();
}

/* =========================================================
   KEYWORD HELPERS
========================================================= */

function containsAny(
  text,
  keywords = []
) {
  return keywords.some((k) =>
    text.includes(k)
  );
}

/* =========================================================
   MAIN INTENT ROUTER
========================================================= */

export function detectIntent(
  query = ""
) {
  try {
    log("================================");

    log("INTENT DETECTION STARTED", {
      query,
    });

    const normalized =
      normalize(query);

    /* =========================================================
       FULL ANALYSIS INTENT
    ========================================================= */

    const fullAnalysisKeywords =
      [
        "review this contract",
        "review this agreement",
        "analyze this contract",
        "analyze this agreement",
        "audit this contract",
        "audit this agreement",
        "find illegal clauses",
        "find risky clauses",
        "check legality",
        "legal review",
        "compliance review",
        "scan this contract",
      ];

    if (
      containsAny(
        normalized,
        fullAnalysisKeywords
      )
    ) {
      log(
        "✅ FULL DOCUMENT ANALYSIS DETECTED"
      );

      return {
        mode:
          "full_document_analysis",

        runClauseCheck: true,

        topK: null,

        taskType:
          "deep_reasoning",
      };
    }

    /* =========================================================
       SUMMARY INTENT
    ========================================================= */

    const summaryKeywords = [
      "summarize",
      "summary",
      "summarise",
      "give overview",
      "explain this document",
      "what is this contract about",
    ];

    if (
      containsAny(
        normalized,
        summaryKeywords
      )
    ) {
      log(
        "✅ DOCUMENT SUMMARY DETECTED"
      );

      return {
        mode:
          "full_document_analysis",

        runClauseCheck: false,

        topK: null,

        taskType: "summary",
      };
    }

    /* =========================================================
       QA RETRIEVAL INTENT
    ========================================================= */

    log(
      "✅ QA RETRIEVAL DETECTED"
    );

    return {
      mode: "qa_retrieval",

      runClauseCheck: false,

      topK: 5,

      taskType: "chat",
    };
  } catch (err) {
    console.error(
      "❌ Intent router failed:",
      {
        message: err?.message,
      }
    );

    /* =========================================================
       SAFE FALLBACK
    ========================================================= */

    return {
      mode: "qa_retrieval",

      runClauseCheck: false,

      topK: 5,

      taskType: "chat",
    };
  } finally {
    log("INTENT DETECTION FINISHED");

    log("================================");
  }
}