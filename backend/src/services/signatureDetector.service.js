// src/services/signatureDetector.service.js
//
// Heuristic detection of a document's trailing signature block, so
// "missing" clauses can be inserted immediately before it instead of after
// it (or appended past the true end of the document).

const SIGNATURE_PATTERNS = [
  /in witness whereof/i,
  /^signature:?/i,
  /signed by/i,
  /authoriz(ed|ation) signatory/i,
  /authoris(ed|ation) signatory/i,
  /^date:?/i,
  /^witness(ed)?:?/i,
  /^for and on behalf of/i,
  /^name:?\s*$/i,
  /^title:?\s*$/i,
  /^by:?\s*_*$/i,
  /^x_{2,}/i,
  /_{3,}/, // underscore fill-in lines ("Signature: ______")
];

// How many trailing paragraphs to consider before giving up and falling
// back to "no signature block found" — keeps this a targeted end-of-document
// scan rather than something that could misfire on a mid-document heading.
const LOOKBACK_LIMIT = 15;

function matchesSignaturePattern(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return false;
  return SIGNATURE_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Scans backward from the end of the document for a trailing run of
 * signature-block-looking paragraphs (blank lines count as part of the
 * block once a marker has been seen).
 *
 * Returns { insertIndex, matched }:
 *   - matched: true if a signature block was actually detected
 *   - insertIndex: the paragraph index new content should be inserted
 *     before. When matched is false, insertIndex === paragraphs.length
 *     (append at the true end — the documented safe fallback).
 */
export function findSignatureAnchor(paragraphs) {
  if (!paragraphs.length) {
    return { insertIndex: 0, matched: false };
  }

  const lastIdx = paragraphs.length - 1;
  const lookbackFloor = Math.max(0, lastIdx - LOOKBACK_LIMIT + 1);

  let insertIndex = paragraphs.length;
  let sawMarker = false;
  let i = lastIdx;

  while (i >= lookbackFloor) {
    const text = paragraphs[i].text;
    const isBlank = !text || !text.trim();
    const isMarker = !isBlank && matchesSignaturePattern(text);

    if (isBlank || isMarker) {
      if (isMarker) sawMarker = true;
      insertIndex = paragraphs[i].index;
      i--;
      continue;
    }
    break;
  }

  if (!sawMarker) {
    return { insertIndex: paragraphs.length, matched: false };
  }

  return { insertIndex, matched: true };
}
