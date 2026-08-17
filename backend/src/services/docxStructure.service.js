// src/services/docxStructure.service.js
//
// Reads/writes the OOXML paragraph tree inside a .docx file's
// word/document.xml. This is the structural layer that everything else
// (clause anchoring, signature detection, patching) is built on — it's what
// lets a revision land on the exact original paragraph instead of a
// plain-text string match, and lets every untouched part of the document
// round-trip byte-for-byte.

import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DOCUMENT_XML_PATH = "word/document.xml";

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[DOCX_STRUCTURE] [${timestamp}] ${step}`, data)
    : console.log(`[DOCX_STRUCTURE] [${timestamp}] ${step}`);
}

/**
 * Unzips a .docx buffer and parses word/document.xml into a DOM. Returns
 * both the zip (for re-serialization later) and the parsed dom.
 */
export function loadDocumentXml(docxBuffer) {
  const zip = new PizZip(docxBuffer);
  const entry = zip.file(DOCUMENT_XML_PATH);
  if (!entry) {
    throw new Error("Not a valid .docx file — word/document.xml missing");
  }
  const dom = new DOMParser().parseFromString(entry.asText(), "text/xml");
  return { zip, dom };
}

/** Re-serializes the (mutated) dom back into the zip and returns the docx buffer. */
export function saveDocumentXml(zip, dom) {
  const xml = new XMLSerializer().serializeToString(dom);
  zip.file(DOCUMENT_XML_PATH, xml);
  return zip.generate({ type: "nodebuffer" });
}

/**
 * Direct <w:p> children of <w:body>, in document order.
 * NOTE: paragraphs nested inside tables (<w:tbl>) are not walked — table
 * clause anchoring is an explicit MVP limitation (see plan verification
 * notes), documents with contract terms inside tables should be flagged
 * for manual review rather than silently mis-anchored.
 */
export function getBodyParagraphs(dom) {
  const body = dom.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) return [];
  const paragraphs = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i];
    if (node.nodeType === 1 && node.namespaceURI === W_NS && node.localName === "p") {
      paragraphs.push(node);
    }
  }
  return paragraphs;
}

function isW(node, localName) {
  return node.nodeType === 1 && node.namespaceURI === W_NS && node.localName === localName;
}

/** Concatenates a paragraph's run text, treating <w:tab/> and <w:br/> as whitespace. */
function paragraphText(pNode) {
  let text = "";
  const walk = (node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType !== 1) continue;
      if (isW(child, "t")) {
        text += child.textContent || "";
      } else if (isW(child, "tab")) {
        text += "\t";
      } else if (isW(child, "br") || isW(child, "cr")) {
        text += "\n";
      } else {
        walk(child);
      }
    }
  };
  walk(pNode);
  return text;
}

/**
 * Extracts the paragraph table used both to prompt clause-checking and to
 * anchor/patch revisions later. Index is stable and 0-based across the
 * document's top-level <w:p> elements.
 */
export function extractParagraphs(docxBuffer) {
  const { dom } = loadDocumentXml(docxBuffer);
  const paragraphs = getBodyParagraphs(dom).map((p, index) => ({
    index,
    text: paragraphText(p).trim(),
  }));
  log("Paragraphs extracted", { count: paragraphs.length });
  return paragraphs;
}

/** Joins the paragraph table into plain text for the LLM prompt / RAG ingestion. */
export function paragraphsToText(paragraphs) {
  return paragraphs
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n");
}
