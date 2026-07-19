import * as geminiLLM from "../llm/gemini.js";
import { AI_MODELS } from "../config/ai.config.js";

/* =========================================================
   LOGGER
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[CLAUSE_CHECKER] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[CLAUSE_CHECKER] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   SAFE TEXT TRIM

   Raised from 4000 → 25000 chars so the health score reflects
   the whole document (a few dozen pages) rather than just the
   first ~page. `truncated` tells the caller (and eventually the
   UI) when a document exceeded this and was cut short.
========================================================= */

const MAX_ANALYSIS_CHARS = 25000;

function trimText(
  text = "",
  max = MAX_ANALYSIS_CHARS
) {
  if (!text) return { text: "", truncated: false };

  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false };
}

/* =========================================================
   HEALTH SCORE

   Computed deterministically from the classified issue counts
   rather than asked of the LLM directly — keeps the number
   auditable/consistent instead of an invented figure.

   Ratio-based: score = how much of the document's expected
   clauses are actually fine, weighted by severity — NOT a flat
   100-minus-penalties deduction. Compliant clauses count fully,
   needs-attention clauses count for half credit, and high-risk /
   missing-mandatory clauses count for none (but still count
   toward the total, since they represent an expected clause).
========================================================= */

function computeHealthScore({ compliant, needsAttention, highRisk, missingMandatory }) {
  const totalClauses = compliant + needsAttention + highRisk + missingMandatory;
  if (totalClauses === 0) return 100;

  const weightedGood = compliant * 1 + needsAttention * 0.5;
  const score = Math.round((weightedGood / totalClauses) * 100);

  return Math.max(0, Math.min(100, score));
}

function computeRecommendation(healthScore) {
  if (healthScore >= 85) {
    return "Looks good — minor review recommended.";
  }
  if (healthScore >= 60) {
    return "Review before signing.";
  }
  return "Do not sign without legal review — significant risks identified.";
}

/* =========================================================
   CLAUSE CHECKER SERVICE
========================================================= */

export class ClauseCheckerService {
  async checkIllegalClauses(
    text,
    country = "nigeria"
  ) {
    const started = Date.now();

    try {
      log(
        "CLAUSE CHECK STARTED",
        {
          country,
          textLength:
            text?.length || 0,
        }
      );

      const { text: trimmed, truncated } = trimText(text);

      const prompt = `
You are a legal compliance assistant reviewing an entire contract/document for the jurisdiction below.

Review the WHOLE document holistically — do not stop at the first issue you find. For every clause that matters (obligations, termination, payment, liability, confidentiality, dispute resolution, etc.), classify it into exactly one status:
- "compliant": the clause is standard and legally sound
- "needs_attention": the clause is unclear, unfair, or potentially problematic but not illegal
- "high_risk": the clause is illegal, unenforceable, or exposes a party to serious liability

Also identify clauses that are MANDATORY for this type of document under the jurisdiction's law but are MISSING from the document entirely — list these with status "missing".

Country:
${country.toUpperCase()}

For every "needs_attention", "high_risk", and "missing" item, provide:
- "clause": short clause name/title (e.g. "Termination")
- "clauseText": the exact verbatim text of the clause as it appears in the document (empty string "" if the clause is "missing" since there's nothing to quote)
- "businessImpact": one or two sentences on the concrete business/legal consequence
- "legalBasis": a FULL statutory citation — section/article number, the act's full name, chapter/cap number if applicable, and "Laws of the Federation of Nigeria <year>" (or the equivalent full citation form for the given country). Do not return a bare act name alone — legal professionals need the complete citation to trust it.
- "suggestedRevision": replacement clause text (or, for "missing" items, the clause text to add) that resolves the issue

Also return "compliantCount": the total number of clauses you classified as "compliant" (do not list them individually, just the count).

Return STRICT JSON ONLY, matching exactly this shape:

{
  "summary": "short overall document summary",
  "compliantCount": 14,
  "issues": [
    {
      "clause": "...",
      "status": "needs_attention|high_risk|missing",
      "clauseText": "...",
      "businessImpact": "...",
      "legalBasis": "...",
      "suggestedRevision": "..."
    }
  ]
}

DOCUMENT:
${trimmed}
`;

      log(
        "Calling Gemini clause analysis"
      );

      const result =
        await geminiLLM.simple(
          prompt,
          {
            taskType:
              "chunk_analysis",

            preferredModel:
              AI_MODELS.FLASH,
          }
        );

      log(
        "Gemini clause analysis completed"
      );

      let parsed = null;

      try {
        parsed =
          typeof result === "string"
            ? JSON.parse(result)
            : result;
      } catch (parseErr) {
        console.error(
          "❌ Failed parsing clause checker JSON:",
          parseErr
        );

        parsed = {
          summary:
            "Failed to parse analysis.",

          compliantCount: 0,

          issues: [],
        };
      }

      const rawIssues = parsed.issues || [];

      const needsAttention = rawIssues.filter((i) => i.status === "needs_attention").length;
      const highRisk = rawIssues.filter((i) => i.status === "high_risk").length;
      const missingMandatory = rawIssues.filter((i) => i.status === "missing").length;
      const compliant = parsed.compliantCount || 0;

      const issues = rawIssues.map((i) => ({
        clause: i.clause || "",
        status: i.status || "needs_attention",
        risk: i.status === "high_risk" ? "high" : i.status === "missing" ? "high" : "medium",
        clauseText: i.clauseText || "",
        businessImpact: i.businessImpact || "",
        legalBasis: i.legalBasis || "",
        suggestedRevision: i.suggestedRevision || "",
      }));

      const healthScore = computeHealthScore({ compliant, needsAttention, highRisk, missingMandatory });
      const overallRecommendation = computeRecommendation(healthScore);

      log(
        "CLAUSE CHECK COMPLETED",
        {
          issuesFound: issues.length,
          healthScore,
          durationMs:
            Date.now() - started,
        }
      );

      return {
        summary:
          parsed.summary || "",

        healthScore,
        truncated,
        overallRecommendation,
        scoreBreakdown: {
          compliant,
          needsAttention,
          highRisk,
          missingMandatory,
        },

        issues,
      };
    } catch (err) {
      console.error(
        "❌ CLAUSE CHECK FAILED:",
        {
          message: err?.message,
          stack: err?.stack,
        }
      );

      return {
        summary:
          "Clause analysis failed.",

        healthScore: null,
        truncated: false,
        overallRecommendation: null,
        scoreBreakdown: null,

        issues: [],
      };
    }
  }
}
