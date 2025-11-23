import * as geminiLLM from "../llm/gemini.js";

export class ClauseCheckerService {
  async checkIllegalClauses(text, country) {
    const prompt = `
You are a legal compliance assistant.

Scan the following document for any clauses that may be illegal, unenforceable, or contradict ${country.toUpperCase()}'s laws.

Return JSON:
- "issues": array of { clause, whyIllegal, recommendedFix }
- "summary": short summary of legality

Document:
${text}
`;

    return await geminiLLM.simple(prompt);
  }
}
