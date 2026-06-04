// src/utils/textChunker.js

/* =========================================================
   Normalize Text
========================================================= */

function normalizeText(text = "") {
  return text
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   Split Into Sentences
========================================================= */

function splitIntoSentences(text) {
  return text.match(
    /[^.!?]+[.!?]+|[^.!?]+$/g
  ) || [];
}

/* =========================================================
   Chunk Text
========================================================= */

export function chunkText(
  text,
  {
    chunkSize = 1200,
    overlap = 200,
    minChunkSize = 150,
  } = {}
) {
  if (
    !text ||
    typeof text !== "string"
  ) {
    return [];
  }

  const cleaned =
    normalizeText(text);

  const sentences =
    splitIntoSentences(cleaned);

  const chunks = [];

  let currentChunk = "";

  for (const sentence of sentences) {
    // If adding sentence exceeds chunk size
    if (
      (
        currentChunk +
        " " +
        sentence
      ).length > chunkSize
    ) {
      if (
        currentChunk.length >=
        minChunkSize
      ) {
        chunks.push(
          currentChunk.trim()
        );
      }

      /* =========================================================
         OVERLAP LOGIC
      ========================================================= */

      const overlapText =
        currentChunk.slice(
          -overlap
        );

      currentChunk =
        overlapText + " " + sentence;
    } else {
      currentChunk +=
        " " + sentence;
    }
  }

  // Push remaining chunk
  if (
    currentChunk.trim().length >=
    minChunkSize
  ) {
    chunks.push(
      currentChunk.trim()
    );
  }

  return chunks;
}