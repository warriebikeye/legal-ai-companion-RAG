// src/services/documentRetriever.service.js

import redis from "./redis.js";

import {
  qdrant,
  USER_DOCS_COLLECTION,
} from "../vectorstore/qdrant.js";

/* =========================================================
   CONFIG
========================================================= */

const DEFAULT_TOP_K = 5;

const MIN_SIMILARITY = 0.50;

/* =========================================================
   LOGGER
========================================================= */

function log(step, data = null) {
  const timestamp =
    new Date().toISOString();

  if (data) {
    console.log(
      `[DOCUMENT_RETRIEVER] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[DOCUMENT_RETRIEVER] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   LOAD CONVERSATION DOCUMENTS
========================================================= */

async function loadConversationDocuments(
  conversationId
) {
  try {
    const key =
      `conversation_docs:${conversationId}`;

    const docs =
      await redis.get(key);

    if (!docs) {
      return [];
    }

    return typeof docs === "string"
      ? JSON.parse(docs)
      : docs;
  } catch (err) {
    console.error(
      "❌ Failed loading conversation documents",
      err
    );

    return [];
  }
}

/* =========================================================
   RETRIEVE RELEVANT CHUNKS
========================================================= */

async function retrieveRelevantChunks({
  queryEmbedding,
  conversationId,
  topK,
}) {
  try {
    const results =
      await qdrant.search(
        USER_DOCS_COLLECTION,
        {
          vector:
            queryEmbedding,

          limit: topK,

          score_threshold:
            MIN_SIMILARITY,

          with_payload: true,

          filter: {
            must: [
              {
                key:
                  "conversationId",

                match: {
                  value:
                    String(
                      conversationId
                    ),
                },
              },
            ],
          },
        }
      );

    const chunks =
      results.map((result) => ({
        text:
          result.payload
            ?.text || "",

        similarity:
          result.score,

        chunkIndex:
          result.payload
            ?.chunkIndex,

        fileName:
          result.payload
            ?.fileName,

        documentHash:
          result.payload
            ?.documentHash,
      }));

    return {
      mode:
        "semantic_qdrant",

      chunks,

      chunkCount:
        chunks.length,
    };
  } catch (err) {
    console.error(
      "❌ Semantic retrieval failed",
      err
    );

    throw err;
  }
}

/* =========================================================
   MAIN RETRIEVER
========================================================= */

export async function retrieveDocumentContext(
  {
    queryEmbedding,

    conversationId,

    mode = "qa_retrieval",

    topK = DEFAULT_TOP_K,
  }
) {
  try {
    log("================================");

    log(
      "DOCUMENT RETRIEVAL STARTED",
      {
        conversationId,
        mode,
        topK,
      }
    );

    if (!conversationId) {
      return {
        mode,
        chunks: [],
        chunkCount: 0,
      };
    }

    const documentHashes =
      await loadConversationDocuments(
        conversationId
      );

    log(
      "Conversation documents loaded",
      {
        documentCount:
          documentHashes.length,
      }
    );

    if (!documentHashes.length) {
      return {
        mode,
        chunks: [],
        chunkCount: 0,
      };
    }

    if (!queryEmbedding) {
      throw new Error(
        "queryEmbedding required"
      );
    }

    return await retrieveRelevantChunks(
      {
        queryEmbedding,
        conversationId,
        topK,
      }
    );
  } catch (err) {
    console.error(
      "❌ DOCUMENT RETRIEVER FAILED",
      {
        message:
          err?.message,
        stack:
          err?.stack,
      }
    );

    throw err;
  }
}