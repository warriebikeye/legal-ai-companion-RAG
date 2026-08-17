import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findSignatureAnchor } from "../src/services/signatureDetector.service.js";

function paragraphs(texts) {
  return texts.map((text, index) => ({ index, text }));
}

describe("signatureDetector.findSignatureAnchor", () => {
  test("detects a classic 'IN WITNESS WHEREOF' block", () => {
    const p = paragraphs([
      "1. Termination Clause",
      "Either party may terminate with notice.",
      "IN WITNESS WHEREOF, the parties have executed this agreement.",
      "Signature: ______________________",
      "Date: ______________________",
    ]);
    const result = findSignatureAnchor(p);
    assert.equal(result.matched, true);
    assert.equal(result.insertIndex, 2);
  });

  test("detects a bare 'Signature:' / 'Date:' block with a blank line before it", () => {
    const p = paragraphs([
      "Both parties agree to the terms above.",
      "",
      "Signature: ______________________",
      "Date: ______________________",
    ]);
    const result = findSignatureAnchor(p);
    assert.equal(result.matched, true);
    assert.equal(result.insertIndex, 1);
  });

  test("detects 'For and on behalf of' / 'Authorized Signatory' markers", () => {
    const p = paragraphs([
      "Confidentiality obligations survive termination.",
      "For and on behalf of the Company:",
      "Authorized Signatory",
    ]);
    const result = findSignatureAnchor(p);
    assert.equal(result.matched, true);
    assert.equal(result.insertIndex, 1);
  });

  test("detects underscore fill-in lines even without an explicit label", () => {
    const p = paragraphs([
      "Both parties accept these terms.",
      "____________________",
      "____________________",
    ]);
    const result = findSignatureAnchor(p);
    assert.equal(result.matched, true);
    assert.equal(result.insertIndex, 1);
  });

  test("falls back to appending at the true end when no signature block exists", () => {
    const p = paragraphs([
      "1. Termination Clause",
      "Either party may terminate with notice.",
      "2. Confidentiality",
      "Both parties agree to keep information confidential.",
    ]);
    const result = findSignatureAnchor(p);
    assert.equal(result.matched, false);
    assert.equal(result.insertIndex, p.length);
  });

  test("handles an empty document without throwing", () => {
    const result = findSignatureAnchor([]);
    assert.equal(result.matched, false);
    assert.equal(result.insertIndex, 0);
  });

  test("does not misfire when the document has no trailing signature block", () => {
    // The last paragraph is ordinary body text, so the backward scan should
    // stop immediately without ever reaching earlier paragraphs — even one
    // containing "Date" near the top of the document.
    const p = paragraphs([
      "Effective Date: January 1, 2026",
      "1. Scope of Work",
      "The contractor shall perform the following services...",
      "2. Payment Terms",
      "Payment is due within 30 days of invoice.",
    ]);
    const result = findSignatureAnchor(p);
    assert.equal(result.matched, false);
    assert.equal(result.insertIndex, p.length);
  });
});
