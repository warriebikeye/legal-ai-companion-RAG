import * as geminiLLM from "../llm/gemini.js";

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
========================================================= */

function trimText(
  text = "",
  max = 4000
) {
  if (!text) return "";

  return text.length > max
    ? text.slice(0, max)
    : text;
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

      const prompt = `
You are a legal compliance assistant.

Analyze this legal document section carefully.

Tasks:
1. Detect illegal clauses
2. Detect risky clauses
3. Detect unenforceable terms
4. Detect suspicious obligations
5. Detect missing protections
6. Explain issues clearly

Country:
${country.toUpperCase()}

Return STRICT JSON ONLY:

{
  "summary": "short section summary",

  "issues": [
    {
      "type": "illegal|risky|warning",

      "clause": "exact problematic clause",

      "reason": "why this is problematic",

      "recommendation": "how to fix it"
    }
  ]
}

DOCUMENT SECTION:
${trimText(text)}
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
              "gemini-2.0-flash",
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

          issues: [],
        };
      }

      log(
        "CLAUSE CHECK COMPLETED",
        {
          issuesFound:
            parsed?.issues
              ?.length || 0,

          durationMs:
            Date.now() - started,
        }
      );

      return {
        summary:
          parsed.summary || "",

        issues:
          parsed.issues || [],
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

        issues: [],
      };
    }
  }
}