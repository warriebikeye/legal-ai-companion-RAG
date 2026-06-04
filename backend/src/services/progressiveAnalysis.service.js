import { ClauseCheckerService } from "./clauseChecker.service.js";

const clauseChecker =
  new ClauseCheckerService();

/* =========================================================
   CONFIG
========================================================= */

const CHUNK_ANALYSIS_BATCH_SIZE = 3;

/* =========================================================
   LOGGER
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[PROGRESSIVE_ANALYSIS] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[PROGRESSIVE_ANALYSIS] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   ANALYZE SINGLE CHUNK
========================================================= */

async function analyzeChunk({
  chunk,
  country = "nigeria",
  chunkNumber,
  totalChunks,
}) {
  const started = Date.now();

  try {
    log("Chunk analysis started", {
      chunkNumber,
      totalChunks,

      chunkLength:
        chunk.text?.length || 0,
    });

    /* =========================================================
       CLAUSE CHECKER
    ========================================================= */

    const result =
      await clauseChecker.checkIllegalClauses(
        chunk.text,
        country
      );

    log("Chunk analysis completed", {
      chunkNumber,

      issuesFound:
        result?.issues
          ?.length || 0,
    });

    return {
      chunkNumber,

      fileName:
        chunk.fileName,

      documentHash:
        chunk.documentHash,

      chunkIndex:
        chunk.chunkIndex,

      summary:
        result.summary || "",

      issues:
        result.issues || [],
    };
  } catch (err) {
    console.error(
      "❌ Chunk analysis failed:",
      {
        chunkNumber,

        error:
          err?.message,
      }
    );

    return {
      chunkNumber,

      summary:
        "Chunk analysis failed.",

      issues: [],

      error:
        err?.message || "Unknown error",
    };
  } finally {
    log("Chunk analysis finished", {
      chunkNumber,

      durationMs:
        Date.now() - started,
    });
  }
}

/* =========================================================
   ANALYZE CHUNKS PROGRESSIVELY
========================================================= */

async function analyzeChunks({
  chunks,
  country,
}) {
  const findings = [];

  const totalChunks =
    chunks.length;

  for (
    let i = 0;
    i < chunks.length;
    i +=
    CHUNK_ANALYSIS_BATCH_SIZE
  ) {
    const batch = chunks.slice(
      i,
      i +
        CHUNK_ANALYSIS_BATCH_SIZE
    );

    log(
      "Processing chunk batch",
      {
        batchStart: i,

        batchSize:
          batch.length,
      }
    );

    /* =========================================================
       PARALLEL BATCH ANALYSIS
    ========================================================= */

    const batchResults =
      await Promise.all(
        batch.map(
          (chunk, index) =>
            analyzeChunk({
              chunk,

              country,

              chunkNumber:
                i + index + 1,

              totalChunks,
            })
        )
      );

    findings.push(...batchResults);
  }

  return findings;
}

/* =========================================================
   CALCULATE RISK LEVEL
========================================================= */

function calculateRiskLevel(
  findings
) {
  const allIssues =
    findings.flatMap(
      (f) => f.issues || []
    );

  const illegalCount =
    allIssues.filter(
      (i) =>
        i.type === "illegal"
    ).length;

  const riskyCount =
    allIssues.filter(
      (i) =>
        i.type === "risky"
    ).length;

  if (illegalCount >= 3) {
    return "high";
  }

  if (
    illegalCount >= 1 ||
    riskyCount >= 5
  ) {
    return "medium";
  }

  return "low";
}

/* =========================================================
   BUILD FINAL SUMMARY
========================================================= */

function buildFinalSummary(
  findings
) {
  const allIssues =
    findings.flatMap(
      (f) => f.issues || []
    );

  return {
    overallSummary: `Document analysis completed across ${findings.length} chunks.`,

    riskLevel:
      calculateRiskLevel(
        findings
      ),

    totalIssues:
      allIssues.length,

    keyIssues:
      allIssues.slice(0, 10),

    recommendations: [
      "Review all flagged clauses carefully.",

      "Seek legal review before signing.",

      "Update unenforceable clauses.",
    ],

    finalVerdict:
      allIssues.length
        ? "Potential legal risks detected."
        : "No major legal issues detected.",
  };
}

/* =========================================================
   MAIN PIPELINE
========================================================= */

export async function runProgressiveAnalysis(
  {
    chunks = [],

    country = "nigeria",
  }
) {
  const started = Date.now();

  try {
    log("================================");

    log(
      "PROGRESSIVE ANALYSIS STARTED",
      {
        chunkCount:
          chunks.length,

        country,
      }
    );

    if (!chunks.length) {
      return {
        findings: [],

        finalSummary: null,
      };
    }

    /* =========================================================
       STEP 1 — CHUNK ANALYSIS
    ========================================================= */

    const findings =
      await analyzeChunks({
        chunks,

        country,
      });

    log(
      "Chunk analysis completed",
      {
        findings:
          findings.length,
      }
    );

    /* =========================================================
       STEP 2 — BUILD SUMMARY
    ========================================================= */

    const finalSummary =
      buildFinalSummary(
        findings
      );

    log(
      "Final summary generated",
      {
        riskLevel:
          finalSummary.riskLevel,
      }
    );

    /* =========================================================
       TOTAL ISSUES
    ========================================================= */

    const totalIssues =
      findings.reduce(
        (acc, item) =>
          acc +
          (
            item.issues
              ?.length || 0
          ),
        0
      );

    const response = {
      mode:
        "full_document_analysis",

      findings,

      totalChunks:
        chunks.length,

      totalIssues,

      finalSummary,
    };

    log(
      "✅ PROGRESSIVE ANALYSIS COMPLETED",
      {
        totalIssues,

        durationMs:
          Date.now() - started,
      }
    );

    log("================================");

    return response;
  } catch (err) {
    console.error(
      "❌ PROGRESSIVE ANALYSIS FAILED:",
      {
        message: err?.message,

        stack: err?.stack,
      }
    );

    throw err;
  }
}