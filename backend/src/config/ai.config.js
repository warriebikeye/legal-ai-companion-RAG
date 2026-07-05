// src/config/ai.config.js

export const AI_MODELS = {
  FLASH:     "gemini-2.5-flash",
  PRO:       "gemini-2.5-pro",
  EMBEDDING: "gemini-embedding-001",
};

export const USER_TIERS = {
  FREE:       "free",
  PREMIUM:    "premium",
  ENTERPRISE: "enterprise",
};

export const AI_TASKS = {
  CHAT:              "chat",
  SUMMARIZATION:     "summarization",   // ← fixed to match model-router usage
  CLASSIFICATION:    "classification",  // ← added
  DOCUMENT_ANALYSIS: "document_analysis",
  LEGAL_REASONING:   "legal_reasoning",
  EMBEDDING:         "embedding",
};

/* =========================================================
   CONTEXT LIMITS
   ─────────────────────────────────────────────────────────
   topKResults raised significantly — with only 5 chunks
   and isCleanChunk filtering, many queries got 0-2 chunks
   of context which is why "no information" was returned.

   All wallet users resolve as "free" tier so free limits
   must be high enough to serve paying users properly.
========================================================= */
export const CONTEXT_LIMITS = {
  free: {
    maxHistoryMessages:    6,
    maxContextChunkLength: 1200,  // was 700
    maxExtraContextLength: 2000,  // was 1200
    topKResults:           15,    // was 5 — critical fix
  },

  premium: {
    maxHistoryMessages:    10,
    maxContextChunkLength: 2000,
    maxExtraContextLength: 5000,
    topKResults:           25,    // was 10
  },

  enterprise: {
    maxHistoryMessages:    16,
    maxContextChunkLength: 3000,
    maxExtraContextLength: 8000,
    topKResults:           35,    // was 15
  },
};

export const MODEL_ROUTING = {
  free: {
    chat:              AI_MODELS.FLASH,
    summarization:     AI_MODELS.FLASH,
    classification:    AI_MODELS.FLASH,
    document_analysis: AI_MODELS.FLASH,
    legal_reasoning:   AI_MODELS.FLASH,
  },

  premium: {
    chat:              AI_MODELS.FLASH,
    summarization:     AI_MODELS.FLASH,
    classification:    AI_MODELS.FLASH,
    document_analysis: AI_MODELS.FLASH,
    legal_reasoning:   AI_MODELS.FLASH,
  },

  enterprise: {
    chat:              AI_MODELS.FLASH,
    summarization:     AI_MODELS.FLASH,
    classification:    AI_MODELS.FLASH,
    document_analysis: AI_MODELS.FLASH,
    legal_reasoning:   AI_MODELS.FLASH,
  },
};

export const MODEL_PRICING = {
  "gemini-2.5-flash": {
    inputPer1M:  0.3,
    outputPer1M: 2.5,
  },
  "gemini-2.5-pro": {
    inputPer1M:  3.5,
    outputPer1M: 10,
  },
};
