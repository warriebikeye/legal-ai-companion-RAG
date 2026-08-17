// test/helpers/buildDocx.js
//
// Builds a minimal but structurally real .docx buffer (a zip containing
// word/document.xml) from an array of paragraph specs, for tests that
// exercise docxStructure/docxPatcher/signatureDetector without needing a
// checked-in binary fixture file.

import PizZip from "pizzip";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {Array<string | {text: string, bold?: boolean}>} paragraphSpecs
 * @returns {Buffer} a .docx buffer
 */
export function buildDocx(paragraphSpecs) {
  const paragraphsXml = paragraphSpecs
    .map((spec) => {
      const { text, bold } = typeof spec === "string" ? { text: spec, bold: false } : spec;
      if (!text) return "<w:p/>";
      const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
      return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
    })
    .join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W_NS}"><w:body>${paragraphsXml}<w:sectPr/></w:body></w:document>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", documentXml);
  return zip.generate({ type: "nodebuffer" });
}
