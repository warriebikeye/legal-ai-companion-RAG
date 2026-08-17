// src/services/docxPatcher.service.js
//
// Applies clause revisions directly onto a .docx's paragraph tree instead
// of rebuilding a document from scratch. Every node outside the paragraphs
// an operation actually touches — styles, media, headers/footers, other
// paragraphs' formatting — round-trips byte-for-byte through the
// unzip/patch/re-zip cycle. That untouched round-trip is the concrete
// mechanism behind "same template as the uploaded document."

import { loadDocumentXml, saveDocumentXml, getBodyParagraphs } from "./docxStructure.service.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[DOCX_PATCHER] [${timestamp}] ${step}`, data)
    : console.log(`[DOCX_PATCHER] [${timestamp}] ${step}`);
}

function isW(node, localName) {
  return node.nodeType === 1 && node.namespaceURI === W_NS && node.localName === localName;
}

function firstChildByLocalName(node, localName) {
  if (!node) return null;
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (isW(child, localName)) return child;
  }
  return null;
}

/** Builds a <w:r> run carrying `text`, optionally cloning an existing <w:rPr> so bold/italic/font survive. */
function buildRun(dom, rPrNode, text) {
  const run = dom.createElementNS(W_NS, "w:r");
  if (rPrNode) {
    run.appendChild(rPrNode.cloneNode(true));
  }
  String(text)
    .split("\n")
    .forEach((line, i) => {
      if (i > 0) {
        run.appendChild(dom.createElementNS(W_NS, "w:br"));
      }
      const t = dom.createElementNS(W_NS, "w:t");
      t.setAttribute("xml:space", "preserve");
      t.appendChild(dom.createTextNode(line));
      run.appendChild(t);
    });
  return run;
}

/** Replaces a paragraph's runs with a single run carrying newText, preserving the original run's formatting. */
function replaceParagraphText(dom, pNode, newText) {
  const existingRun = firstChildByLocalName(pNode, "r");
  const rPr = existingRun ? firstChildByLocalName(existingRun, "rPr") : null;

  const toRemove = [];
  for (let i = 0; i < pNode.childNodes.length; i++) {
    const child = pNode.childNodes[i];
    if (isW(child, "r") || isW(child, "hyperlink")) toRemove.push(child);
  }
  toRemove.forEach((child) => pNode.removeChild(child));

  pNode.appendChild(buildRun(dom, rPr, newText));
}

/** Builds a new <w:p>, inheriting paragraph style (pPr) and run formatting (rPr) from a template paragraph. */
function buildParagraph(dom, templateParagraph, text) {
  const p = dom.createElementNS(W_NS, "w:p");

  const templatePPr = templateParagraph ? firstChildByLocalName(templateParagraph, "pPr") : null;
  if (templatePPr) {
    p.appendChild(templatePPr.cloneNode(true));
  }

  const templateRun = templateParagraph ? firstChildByLocalName(templateParagraph, "r") : null;
  const rPr = templateRun ? firstChildByLocalName(templateRun, "rPr") : null;
  p.appendChild(buildRun(dom, rPr, text));

  return p;
}

/**
 * Applies a set of patch operations to a .docx buffer and returns the
 * patched buffer.
 *
 * operations: Array<
 *   | { type: "replace", paragraphIndex: number, newText: string }
 *   | { type: "insert", atIndex: number, newText: string }
 * >
 *
 * `paragraphIndex`/`atIndex` refer to the ORIGINAL paragraph indices (as
 * produced by docxStructure.extractParagraphs) — not indices recomputed
 * after earlier operations run, since inserts are resolved against node
 * references captured before any mutation happens.
 */
export function applyRevisions(docxBuffer, operations) {
  const { zip, dom } = loadDocumentXml(docxBuffer);
  const body = dom.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) throw new Error("Malformed docx — <w:body> not found");

  // Captured once, before any mutation — insert operations resolve their
  // reference node from this untouched snapshot, so processing order never
  // matters and replace/insert ops can't interfere with each other's indices.
  const originalParagraphs = getBodyParagraphs(dom);
  const sectPr = firstChildByLocalName(body, "sectPr");

  const replaceOps = operations.filter((op) => op.type === "replace");
  const insertOps = operations.filter((op) => op.type === "insert");

  for (const op of replaceOps) {
    const pNode = originalParagraphs[op.paragraphIndex];
    if (!pNode) {
      log("Replace target paragraph not found, skipping", { paragraphIndex: op.paragraphIndex });
      continue;
    }
    replaceParagraphText(dom, pNode, op.newText);
  }

  for (const op of insertOps) {
    const referenceNode =
      op.atIndex < originalParagraphs.length ? originalParagraphs[op.atIndex] : sectPr || null;
    const templateParagraph =
      originalParagraphs[op.atIndex - 1] ||
      originalParagraphs[op.atIndex] ||
      originalParagraphs[originalParagraphs.length - 1] ||
      null;

    const newParagraph = buildParagraph(dom, templateParagraph, op.newText);

    if (referenceNode) {
      body.insertBefore(newParagraph, referenceNode);
    } else {
      body.appendChild(newParagraph);
    }
  }

  log("Revisions applied", { replaced: replaceOps.length, inserted: insertOps.length });
  return saveDocumentXml(zip, dom);
}
