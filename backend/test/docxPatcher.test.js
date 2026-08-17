import { test, describe } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { buildDocx } from "./helpers/buildDocx.js";
import { extractParagraphs } from "../src/services/docxStructure.service.js";
import { applyRevisions } from "../src/services/docxPatcher.service.js";

/** Reads the raw word/document.xml string back out of a patched docx buffer. */
function readDocumentXml(docxBuffer) {
  const zip = new PizZip(docxBuffer);
  return zip.file("word/document.xml").asText();
}

describe("docxPatcher.applyRevisions — replace", () => {
  test("replaces only the targeted paragraph's text", () => {
    const docx = buildDocx(["Paragraph zero.", "Paragraph one (old).", "Paragraph two."]);

    const patched = applyRevisions(docx, [
      { type: "replace", paragraphIndex: 1, newText: "Paragraph one (revised)." },
    ]);
    const result = extractParagraphs(patched);

    assert.equal(result.length, 3);
    assert.equal(result[0].text, "Paragraph zero.");
    assert.equal(result[1].text, "Paragraph one (revised).");
    assert.equal(result[2].text, "Paragraph two.");
  });

  test("preserves the original run's formatting (bold) on the replaced paragraph", () => {
    const docx = buildDocx([{ text: "Bold clause text.", bold: true }]);

    const patched = applyRevisions(docx, [
      { type: "replace", paragraphIndex: 0, newText: "Revised bold clause." },
    ]);

    const result = extractParagraphs(patched);
    assert.equal(result[0].text, "Revised bold clause.");

    // The concrete "same template" check: the replaced paragraph's run
    // still carries <w:b/> even though its text changed.
    const xml = readDocumentXml(patched);
    assert.match(xml, /<w:b\/>/);
    assert.match(xml, /Revised bold clause\./);
  });

  test("skips a replace targeting an out-of-range paragraph index without throwing", () => {
    const docx = buildDocx(["Only paragraph."]);
    const patched = applyRevisions(docx, [
      { type: "replace", paragraphIndex: 5, newText: "Should be ignored." },
    ]);
    const result = extractParagraphs(patched);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "Only paragraph.");
  });

  test("splits a multi-line replacement into separate lines via <w:br/>", () => {
    const docx = buildDocx(["Original."]);
    const patched = applyRevisions(docx, [
      { type: "replace", paragraphIndex: 0, newText: "Line one\nLine two" },
    ]);
    const result = extractParagraphs(patched);
    assert.equal(result[0].text, "Line one\nLine two");
  });
});

describe("docxPatcher.applyRevisions — insert", () => {
  test("inserts a new paragraph before the specified index", () => {
    const docx = buildDocx(["Zero.", "One.", "Two."]);
    const patched = applyRevisions(docx, [
      { type: "insert", atIndex: 2, newText: "Inserted before Two." },
    ]);
    const result = extractParagraphs(patched);

    assert.equal(result.length, 4);
    assert.deepEqual(
      result.map((p) => p.text),
      ["Zero.", "One.", "Inserted before Two.", "Two."]
    );
  });

  test("appends at the true end when atIndex === paragraphs.length", () => {
    const docx = buildDocx(["Zero.", "One."]);
    const patched = applyRevisions(docx, [
      { type: "insert", atIndex: 2, newText: "Appended." },
    ]);
    const result = extractParagraphs(patched);

    assert.equal(result.length, 3);
    assert.equal(result[2].text, "Appended.");
  });

  test("multiple inserts at the same index preserve relative order", () => {
    const docx = buildDocx(["Zero.", "One."]);
    const patched = applyRevisions(docx, [
      { type: "insert", atIndex: 1, newText: "First inserted." },
      { type: "insert", atIndex: 1, newText: "Second inserted." },
    ]);
    const result = extractParagraphs(patched);

    assert.deepEqual(
      result.map((p) => p.text),
      ["Zero.", "First inserted.", "Second inserted.", "One."]
    );
  });
});

describe("docxPatcher.applyRevisions — untouched content round-trips", () => {
  test("paragraphs not targeted by any operation are unchanged", () => {
    const docx = buildDocx(["A", "B", "C", "D", "E"]);
    const patched = applyRevisions(docx, [
      { type: "replace", paragraphIndex: 2, newText: "C (revised)" },
    ]);
    const result = extractParagraphs(patched);

    assert.equal(result[0].text, "A");
    assert.equal(result[1].text, "B");
    assert.equal(result[3].text, "D");
    assert.equal(result[4].text, "E");
  });

  test("zip entries outside word/document.xml round-trip byte-for-byte (same template)", () => {
    const docx = buildDocx(["A", "B (to be replaced)", "C"]);
    const zip = new PizZip(docx);
    zip.file("word/styles.xml", "<w:styles>fake-styles-content</w:styles>");
    zip.file("word/media/image1.png", Buffer.from([1, 2, 3, 4]));
    const docxWithExtras = zip.generate({ type: "nodebuffer" });

    const patched = applyRevisions(docxWithExtras, [
      { type: "replace", paragraphIndex: 1, newText: "B (revised)" },
    ]);

    const patchedZip = new PizZip(patched);
    assert.equal(patchedZip.file("word/styles.xml").asText(), "<w:styles>fake-styles-content</w:styles>");
    assert.deepEqual([...patchedZip.file("word/media/image1.png").asUint8Array()], [1, 2, 3, 4]);
  });

  test("combining replace + insert in one call applies both correctly", () => {
    const docx = buildDocx(["Intro.", "Old clause.", "Signature: ____"]);
    const patched = applyRevisions(docx, [
      { type: "replace", paragraphIndex: 1, newText: "New clause." },
      { type: "insert", atIndex: 2, newText: "Missing clause added." },
    ]);
    const result = extractParagraphs(patched);

    assert.deepEqual(
      result.map((p) => p.text),
      ["Intro.", "New clause.", "Missing clause added.", "Signature: ____"]
    );
  });
});
