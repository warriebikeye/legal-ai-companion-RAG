import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildDocx } from "./helpers/buildDocx.js";
import { extractParagraphs, paragraphsToText } from "../src/services/docxStructure.service.js";

describe("docxStructure.extractParagraphs", () => {
  test("extracts paragraph count and text in document order", () => {
    const docx = buildDocx(["First paragraph.", "Second paragraph.", "Third paragraph."]);
    const paragraphs = extractParagraphs(docx);

    assert.equal(paragraphs.length, 3);
    assert.deepEqual(
      paragraphs.map((p) => p.text),
      ["First paragraph.", "Second paragraph.", "Third paragraph."]
    );
  });

  test("assigns stable 0-based indices matching array position", () => {
    const docx = buildDocx(["A", "B", "C"]);
    const paragraphs = extractParagraphs(docx);
    paragraphs.forEach((p, i) => assert.equal(p.index, i));
  });

  test("handles empty paragraphs", () => {
    const docx = buildDocx(["Before", "", "After"]);
    const paragraphs = extractParagraphs(docx);

    assert.equal(paragraphs.length, 3);
    assert.equal(paragraphs[1].text, "");
  });

  test("concatenates multi-run paragraphs (bold mid-sentence)", () => {
    // Simulates "Either party may **terminate** this agreement" —
    // three runs, only the middle one bold — text extraction should
    // still read as one continuous paragraph.
    const docx = buildDocx([
      { text: "Either party may terminate this agreement.", bold: false },
    ]);
    const paragraphs = extractParagraphs(docx);
    assert.equal(paragraphs[0].text, "Either party may terminate this agreement.");
  });

  test("throws on a non-docx buffer", () => {
    assert.throws(() => extractParagraphs(Buffer.from("not a zip")));
  });
});

describe("docxStructure.paragraphsToText", () => {
  test("joins non-empty paragraphs with blank lines, dropping empties", () => {
    const paragraphs = [
      { index: 0, text: "First." },
      { index: 1, text: "" },
      { index: 2, text: "Second." },
    ];
    assert.equal(paragraphsToText(paragraphs), "First.\n\nSecond.");
  });
});
