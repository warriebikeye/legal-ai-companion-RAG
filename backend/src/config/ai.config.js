// src/config/ai.config.js

/* =========================================================
   AI MODEL CONFIGURATION
========================================================= */

export const AI_MODELS = {
  FLASH: "gemini-2.5-flash",
  PRO: "gemini-2.5-pro",
  EMBEDDING: "gemini-embedding-001",
};

/* =========================================================
   USER TIERS
========================================================= */

export const USER_TIERS = {
  FREE: "free",
  PREMIUM: "premium",
  ENTERPRISE: "enterprise",
};

/* =========================================================
   TASK TYPES
========================================================= */

export const AI_TASKS = {
  CHAT: "chat",
  SUMMARY: "summary",
  DOCUMENT_ANALYSIS: "document_analysis",
  LEGAL_REASONING: "legal_reasoning",
  EMBEDDING: "embedding",
};

/* =========================================================
   CONTEXT LIMITS
========================================================= */

export const CONTEXT_LIMITS = {
  free: {
    maxHistoryMessages: 4,
    maxContextChunkLength: 700,
    maxExtraContextLength: 1200,
    topKResults: 5,
  },

  premium: {
    maxHistoryMessages: 8,
    maxContextChunkLength: 1600,
    maxExtraContextLength: 4000,
    topKResults: 10,
  },

  enterprise: {
    maxHistoryMessages: 12,
    maxContextChunkLength: 3000,
    maxExtraContextLength: 8000,
    topKResults: 15,
  },
};

/* =========================================================
   MODEL ROUTING RULES
========================================================= */

export const MODEL_ROUTING = {
  free: {
    chat: AI_MODELS.FLASH,
    summary: AI_MODELS.FLASH,
    document_analysis: AI_MODELS.FLASH,
    legal_reasoning: AI_MODELS.FLASH,
  },

  premium: {
    chat: AI_MODELS.PRO,
    summary: AI_MODELS.FLASH,
    document_analysis: AI_MODELS.PRO,
    legal_reasoning: AI_MODELS.PRO,
  },

  enterprise: {
    chat: AI_MODELS.PRO,
    summary: AI_MODELS.PRO,
    document_analysis: AI_MODELS.PRO,
    legal_reasoning: AI_MODELS.PRO,
  },
};

/* =========================================================
   COST ESTIMATION
   (Approximation for analytics)
========================================================= */

export const MODEL_PRICING = {
  "gemini-2.5-flash": {
    inputPer1M: 0.3,
    outputPer1M: 2.5,
  },

  "gemini-2.5-pro": {
    inputPer1M: 3.5,
    outputPer1M: 10,
  },
};