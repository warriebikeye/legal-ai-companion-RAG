// src/services/clauseAnchor.service.js
//
// Resolves a clauseChecker issue to the exact paragraph it should patch,
// instead of the fragile plain-text `.replace()` the app used before this
// feature. Resolution is tiered so a wrong/missing LLM-provided index never
// silently corrupts the wrong paragraph:
//
//   1. trust issue.paragraphIndex, but only if it's in range AND the
//      paragraph's own text actually overlaps clauseText (sanity check
//      against index hallucination)
//   2. normalized substring match against every paragraph
//   3. embedding-similarity fallback (reuses the same getEmbedding() this
//      codebase already calls for Qdrant upserts — computed in-process,
//      no Qdrant round-trip, since this is a one-off few-hundred-vector
//      comparison per generation, not a search-at-scale problem)
//   4. "missing" issues always anchor to the signature block
//
// If none of these can confidently place an issue, resolveAnchor returns
// { unresolved: true } — the caller skips that operation rather than
// guessing, so an unanchorable revision is simply not applied instead of
// silently patching the wrong paragraph.

import * as geminiLLM from "../llm/gemini.js";

const SIMILARITY_THRESHOLD = 0.82;
const WORD_OVERLAP_THRESHOLD = 0.4;
const MIN_WORD_LENGTH = 3;

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[CLAUSE_ANCHOR] [${timestamp}] ${step}`, data)
    : console.log(`[CLAUSE_ANCHOR] [${timestamp}] ${step}`);
}

function normalize(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function wordSet(text) {
  return new Set(
    normalize(text)
      .split(/\W+/)
      .filter((w) => w.length >= MIN_WORD_LENGTH)
  );
}

function wordOverlapRatio(a, b) {
  const wa = wordSet(a);
  const wb = wordSet(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

function overlaps(paragraphText, clauseText) {
  const np = normalize(paragraphText);
  const nc = normalize(clauseText);
  if (!np || !nc) return false;
  if (np.includes(nc) || nc.includes(np)) return true;
  return wordOverlapRatio(np, nc) >= WORD_OVERLAP_THRESHOLD;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Step 1 — trust the LLM's paragraphIndex if it's plausible. */
function resolveByIndex(issue, paragraphs) {
  const idx = issue.paragraphIndex;
  if (idx === null || idx === undefined) return null;
  const paragraph = paragraphs[idx];
  if (!paragraph || paragraph.index !== idx) return null;
  if (!issue.clauseText || overlaps(paragraph.text, issue.clauseText)) {
    return { paragraphIndex: idx };
  }
  return null;
}

/** Step 2 — normalized substring match across every paragraph. */
function resolveBySubstring(issue, paragraphs) {
  if (!issue.clauseText) return null;
  const nc = normalize(issue.clauseText);
  if (!nc) return null;

  let best = null;
  let bestScore = 0;
  for (const paragraph of paragraphs) {
    const np = normalize(paragraph.text);
    if (!np) continue;
    if (np.includes(nc) || nc.includes(np)) {
      // Prefer the closest length match when multiple paragraphs contain it.
      const score = Math.min(np.length, nc.length) / Math.max(np.length, nc.length);
      if (score > bestScore) {
        bestScore = score;
        best = paragraph.index;
      }
    }
  }
  return best !== null ? { paragraphIndex: best } : null;
}

/**
 * Embeds every paragraph once so a batch of issues can reuse the same
 * vectors instead of re-embedding the whole document per issue.
 *
 * `embedFn` defaults to the real Gemini embedding call and is only ever
 * overridden by tests (clauseAnchor.test.js) — production call sites never
 * pass it, so behavior is unchanged outside of tests.
 */
export async function embedParagraphs(paragraphs, embedFn = geminiLLM.getEmbedding) {
  const embeddings = new Map();
  for (const paragraph of paragraphs) {
    if (!paragraph.text) continue;
    try {
      embeddings.set(paragraph.index, await embedFn(paragraph.text));
    } catch (err) {
      log("Paragraph embedding failed, skipping paragraph", {
        index: paragraph.index,
        error: err.message,
      });
    }
  }
  return embeddings;
}

/** Step 3 — embedding-similarity fallback. */
async function resolveByEmbedding(issue, paragraphs, paragraphEmbeddings, embedFn = geminiLLM.getEmbedding) {
  if (!issue.clauseText || !paragraphEmbeddings?.size) return null;

  let clauseEmbedding;
  try {
    clauseEmbedding = await embedFn(issue.clauseText);
  } catch (err) {
    log("Clause embedding failed", { error: err.message });
    return null;
  }

  let best = null;
  let bestScore = SIMILARITY_THRESHOLD;
  for (const [index, embedding] of paragraphEmbeddings) {
    const score = cosineSimilarity(clauseEmbedding, embedding);
    if (score >= bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best !== null ? { paragraphIndex: best } : null;
}

/**
 * Resolves a single issue to a patch anchor. Pass a precomputed
 * `paragraphEmbeddings` map (from embedParagraphs) when resolving many
 * issues against the same document to avoid redundant embedding calls —
 * see resolveAnchors() for the batched entry point.
 */
export async function resolveAnchor(
  issue,
  paragraphs,
  { paragraphEmbeddings = null, embedFn = geminiLLM.getEmbedding } = {}
) {
  if (issue.status === "missing") {
    return { insertBeforeSignature: true };
  }

  const byIndex = resolveByIndex(issue, paragraphs);
  if (byIndex) return byIndex;

  const bySubstring = resolveBySubstring(issue, paragraphs);
  if (bySubstring) return bySubstring;

  const embeddings = paragraphEmbeddings || (await embedParagraphs(paragraphs, embedFn));
  const byEmbedding = await resolveByEmbedding(issue, paragraphs, embeddings, embedFn);
  if (byEmbedding) return byEmbedding;

  log("Issue could not be anchored — skipping", { clause: issue.clause });
  return { unresolved: true };
}

/**
 * Batched resolution for a set of issues against one document. Paragraph
 * embeddings are computed at most once, lazily, only if at least one issue
 * actually needs the fuzzy fallback. `embedFn` is test-only (see
 * resolveAnchor's jsdoc above) — production callers never pass it.
 */
export async function resolveAnchors(issues, paragraphs, { embedFn = geminiLLM.getEmbedding } = {}) {
  let paragraphEmbeddings = null;
  const results = [];

  for (const issue of issues) {
    if (issue.status === "missing") {
      results.push({ insertBeforeSignature: true });
      continue;
    }

    const byIndex = resolveByIndex(issue, paragraphs);
    if (byIndex) {
      results.push(byIndex);
      continue;
    }

    const bySubstring = resolveBySubstring(issue, paragraphs);
    if (bySubstring) {
      results.push(bySubstring);
      continue;
    }

    if (!paragraphEmbeddings) {
      paragraphEmbeddings = await embedParagraphs(paragraphs, embedFn);
    }
    const byEmbedding = await resolveByEmbedding(issue, paragraphs, paragraphEmbeddings, embedFn);
    if (byEmbedding) {
      results.push(byEmbedding);
      continue;
    }

    log("Issue could not be anchored — skipping", { clause: issue.clause });
    results.push({ unresolved: true });
  }

  return results;
}
