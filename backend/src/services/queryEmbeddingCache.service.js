// src/services/queryEmbeddingCache.service.js

import crypto from "crypto";

import redis from "./redis.js";

import * as geminiLLM from "../llm/gemini.js";

/* =========================================================
   CONFIG
========================================================= */

const QUERY_CACHE_TTL =
  Number(process.env.QUERY_EMBEDDING_TTL) ||
  60 * 60 * 24;

/* =========================================================
   LOGGER
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[QUERY_EMBEDDING_CACHE] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[QUERY_EMBEDDING_CACHE] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   NORMALIZE QUERY
========================================================= */

function normalizeQuery(query = "") {
  return query
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   HASH QUERY
========================================================= */

function hashQuery(query) {
  return crypto
    .createHash("sha256")
    .update(query)
    .digest("hex");
}

/* =========================================================
   GET CACHED QUERY EMBEDDING
========================================================= */

export async function getCachedQueryEmbedding(
  query
) {
  try {
    const normalizedQuery =
      normalizeQuery(query);

    const queryHash =
      hashQuery(normalizedQuery);

    const cacheKey =
      `query_embedding:${queryHash}`;

    /* =====================================================
       CACHE CHECK
    ===================================================== */

    const cached =
      await redis.get(cacheKey);

    if (cached) {
      log(
        "✅ QUERY EMBEDDING CACHE HIT",
        {
          query:
            normalizedQuery.slice(
              0,
              80
            ),
        }
      );

      return typeof cached ===
        "string"
        ? JSON.parse(cached)
        : cached;
    }

    log(
      "❌ QUERY EMBEDDING CACHE MISS",
      {
        query:
          normalizedQuery.slice(
            0,
            80
          ),
      }
    );

    /* =====================================================
       GENERATE EMBEDDING
    ===================================================== */

    const embedding =
      await geminiLLM.getEmbedding(
        normalizedQuery
      );

    /* =====================================================
       CACHE EMBEDDING
    ===================================================== */

    await redis.set(
      cacheKey,
      JSON.stringify(embedding),
      {
        ex: QUERY_CACHE_TTL,
      }
    );

    log(
      "✅ QUERY EMBEDDING CACHED",
      {
        ttl:
          QUERY_CACHE_TTL,
      }
    );

    return embedding;
  } catch (err) {
    console.error(
      "❌ Query embedding cache failed:",
      {
        message:
          err?.message,
      }
    );

    /* =====================================================
       FALLBACK
    ===================================================== */

    return await geminiLLM.getEmbedding(
      query
    );
  }
}