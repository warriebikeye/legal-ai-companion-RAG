// test/documentGeneration.e2e.test.js
//
// Synthetic end-to-end test of the full "apply accepted revisions" pipeline
// (extractParagraphs -> resolveAnchors -> findSignatureAnchor ->
// applyRevisions) against an in-memory docx buffer — everything the real
// documentGeneration.service.js does, minus the parts that need live infra
// (MongoDB, Cloudinary, Gotenberg). Those need a running environment and
// aren't meaningfully unit-testable; this covers the actual document-editing
// logic, which is where a structural bug would hide.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocx } from "./helpers/buildDocx.js";
import { extractParagraphs } from "../src/services/docxStructure.service.js";
import { resolveAnchors } from "../src/services/clauseAnchor.service.js";
import { findSignatureAnchor } from "../src/services/signatureDetector.service.js";
import { applyRevisions } from "../src/services/docxPatcher.service.js";

function fakeEmbedFn(text) {
  return Promise.resolve([text.length]); // not exercised in this test — everything resolves via index/substring
}

test("end-to-end: replace + insert-missing-before-signature, non-selected text untouched", async () => {
  const original = buildDocx([
    "1. Termination Clause",
    "Either party may terminate this agreement at will without notice.",
    "2. Confidentiality",
    "Both parties agree to keep information confidential.",
    "",
    "IN WITNESS WHEREOF, the parties have executed this agreement.",
    "Signature: ______________________",
    "Date: ______________________",
  ]);

  const paragraphs = extractParagraphs(original);

  // Simulates clauseChecker.service.js output for this document.
  const issues = [
    {
      status: "high_risk",
      clause: "Termination",
      clauseText: "Either party may terminate this agreement at will without notice.",
      suggestedRevision: "Either party may terminate this agreement with 30 days written notice.",
      paragraphIndex: 1,
    },
    {
      status: "missing",
      clause: "Governing Law",
      clauseText: "",
      suggestedRevision: "This agreement shall be governed by the laws of Nigeria.",
    },
  ];

  const anchors = await resolveAnchors(issues, paragraphs, { embedFn: fakeEmbedFn });
  const signatureAnchor = findSignatureAnchor(paragraphs);

  assert.deepEqual(anchors[0], { paragraphIndex: 1 });
  assert.deepEqual(anchors[1], { insertBeforeSignature: true });
  assert.equal(signatureAnchor.matched, true);

  const operations = [
    { type: "replace", paragraphIndex: anchors[0].paragraphIndex, newText: issues[0].suggestedRevision },
    {
      type: "insert",
      atIndex: signatureAnchor.insertIndex,
      newText: `${issues[1].clause}\n${issues[1].suggestedRevision}`,
    },
  ];

  const patched = applyRevisions(original, operations);
  const result = extractParagraphs(patched);

  assert.deepEqual(
    result.map((p) => p.text),
    [
      "1. Termination Clause",
      "Either party may terminate this agreement with 30 days written notice.",
      "2. Confidentiality",
      "Both parties agree to keep information confidential.",
      "Governing Law\nThis agreement shall be governed by the laws of Nigeria.",
      "",
      "IN WITNESS WHEREOF, the parties have executed this agreement.",
      "Signature: ______________________",
      "Date: ______________________",
    ]
  );

  // Non-selected clause ("2. Confidentiality" section) must be byte-identical.
  assert.equal(result[3].text, "Both parties agree to keep information confidential.");
});

test("end-to-end: falls back to appending at the true end when no signature block is present", async () => {
  const original = buildDocx([
    "1. Scope",
    "The contractor shall deliver the services described in Exhibit A.",
  ]);
  const paragraphs = extractParagraphs(original);

  const issues = [
    {
      status: "missing",
      clause: "Dispute Resolution",
      clauseText: "",
      suggestedRevision: "Disputes shall be resolved through binding arbitration.",
    },
  ];

  const anchors = await resolveAnchors(issues, paragraphs, { embedFn: fakeEmbedFn });
  const signatureAnchor = findSignatureAnchor(paragraphs);
  assert.equal(signatureAnchor.matched, false);
  assert.equal(signatureAnchor.insertIndex, paragraphs.length);

  const patched = applyRevisions(original, [
    {
      type: "insert",
      atIndex: signatureAnchor.insertIndex,
      newText: `${issues[0].clause}\n${issues[0].suggestedRevision}`,
    },
  ]);
  const result = extractParagraphs(patched);

  assert.equal(result.length, 3);
  assert.equal(result[2].text, "Dispute Resolution\nDisputes shall be resolved through binding arbitration.");
});
