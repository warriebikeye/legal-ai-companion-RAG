import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveAnchor, resolveAnchors } from "../src/services/clauseAnchor.service.js";

function paragraphs(texts) {
  return texts.map((text, index) => ({ index, text }));
}

// Deterministic fake embeddings for testing the fuzzy fallback without
// hitting the live Gemini API: a bag-of-significant-words hashed into a
// wide bucket space (collisions negligible at this vocabulary size), so
// texts sharing content words score near 1.0 and unrelated texts score
// near 0 — good enough to exercise the SIMILARITY_THRESHOLD logic without
// needing real semantic embeddings.
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "to", "of", "in", "on", "by", "and", "or",
  "this", "that", "must", "be", "given", "all", "above", "stated", "at", "without",
]);

function fakeEmbedFn(text) {
  const buckets = new Array(512).fill(0);
  const words = text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
    buckets[hash % buckets.length] += 1;
  }
  return Promise.resolve(buckets);
}

describe("clauseAnchor.resolveAnchor — index trust", () => {
  test("trusts a valid, overlapping paragraphIndex from the LLM", async () => {
    const p = paragraphs([
      "1. Termination",
      "Either party may terminate this agreement at will without notice.",
      "2. Confidentiality",
    ]);
    const issue = {
      status: "high_risk",
      clause: "Termination",
      clauseText: "Either party may terminate this agreement at will without notice.",
      paragraphIndex: 1,
    };
    const result = await resolveAnchor(issue, p, { embedFn: fakeEmbedFn });
    assert.deepEqual(result, { paragraphIndex: 1 });
  });

  test("rejects a hallucinated index and falls back to substring match", async () => {
    const p = paragraphs([
      "1. Termination",
      "Either party may terminate this agreement at will without notice.",
      "2. Confidentiality",
      "Both parties agree to keep information confidential.",
    ]);
    const issue = {
      status: "needs_attention",
      clause: "Confidentiality",
      clauseText: "Both parties agree to keep information confidential.",
      paragraphIndex: 0, // hallucinated — doesn't overlap paragraph 0's text
    };
    const result = await resolveAnchor(issue, p, { embedFn: fakeEmbedFn });
    assert.deepEqual(result, { paragraphIndex: 3 });
  });
});

describe("clauseAnchor.resolveAnchor — substring fallback", () => {
  test("matches via normalized substring when no paragraphIndex is given", async () => {
    const p = paragraphs(["Intro.", "The term of this agreement is 12 months.", "Outro."]);
    const issue = {
      status: "needs_attention",
      clause: "Term",
      clauseText: "the term of this agreement is 12 months",
      paragraphIndex: null,
    };
    const result = await resolveAnchor(issue, p, { embedFn: fakeEmbedFn });
    assert.deepEqual(result, { paragraphIndex: 1 });
  });
});

describe("clauseAnchor.resolveAnchor — embedding fallback", () => {
  test("falls back to embedding similarity when index and substring both fail", async () => {
    const p = paragraphs([
      "1. Governing Law",
      "This agreement is governed by the laws of the jurisdiction stated above.",
      "2. Notices",
      "All notices must be given in writing to the registered address.",
    ]);
    // Paraphrased, not a substring match — same words as paragraph 3 though.
    const issue = {
      status: "needs_attention",
      clause: "Notices",
      clauseText: "notices writing registered address",
      paragraphIndex: null,
    };
    const result = await resolveAnchor(issue, p, { embedFn: fakeEmbedFn });
    assert.deepEqual(result, { paragraphIndex: 3 });
  });

  test("returns { unresolved: true } when nothing matches confidently", async () => {
    const p = paragraphs(["Alpha bravo charlie.", "Delta echo foxtrot."]);
    const issue = {
      status: "needs_attention",
      clause: "Unrelated",
      clauseText: "zulu yankee xray whiskey",
      paragraphIndex: null,
    };
    const result = await resolveAnchor(issue, p, { embedFn: fakeEmbedFn });
    assert.deepEqual(result, { unresolved: true });
  });
});

describe("clauseAnchor.resolveAnchor — missing clauses", () => {
  test("always anchors 'missing' status to the signature block, ignoring clauseText", async () => {
    const p = paragraphs(["Anything.", "Something else."]);
    const issue = { status: "missing", clause: "Governing Law", clauseText: "" };
    const result = await resolveAnchor(issue, p, { embedFn: fakeEmbedFn });
    assert.deepEqual(result, { insertBeforeSignature: true });
  });
});

describe("clauseAnchor.resolveAnchors — batch", () => {
  test("resolves a mixed batch (index, substring-recovered, missing) in one call", async () => {
    const p = paragraphs([
      "1. Termination",
      "Either party may terminate this agreement at will without notice.",
      "2. Confidentiality",
      "Both parties agree to keep information confidential.",
    ]);
    const issues = [
      {
        status: "high_risk",
        clause: "Termination",
        clauseText: "Either party may terminate this agreement at will without notice.",
        paragraphIndex: 1,
      },
      {
        status: "needs_attention",
        clause: "Confidentiality",
        clauseText: "Both parties agree to keep information confidential.",
        paragraphIndex: 0, // hallucinated
      },
      { status: "missing", clause: "Governing Law", clauseText: "" },
    ];

    const results = await resolveAnchors(issues, p, { embedFn: fakeEmbedFn });

    assert.deepEqual(results, [
      { paragraphIndex: 1 },
      { paragraphIndex: 3 },
      { insertBeforeSignature: true },
    ]);
  });
});
