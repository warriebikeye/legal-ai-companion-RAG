// src/services/model-router.service.js

import {
  AI_MODELS,
  AI_TASKS,
  CONTEXT_LIMITS,
  MODEL_ROUTING,
  USER_TIERS,
} from "../config/ai.config.js";

/* =========================================================
   Logger
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[MODEL_ROUTER] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[MODEL_ROUTER] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   Normalize Tier
========================================================= */

export function normalizeTier(tier) {
  if (!tier) {
    return USER_TIERS.FREE;
  }

  const normalized =
    String(tier).toLowerCase();

  if (
    normalized !== USER_TIERS.FREE &&
    normalized !== USER_TIERS.PREMIUM &&
    normalized !== USER_TIERS.ENTERPRISE
  ) {
    return USER_TIERS.FREE;
  }

  return normalized;
}

/* =========================================================
   Get AI Model
========================================================= */

export function getModelForTask({
  userTier = USER_TIERS.FREE,
  task = AI_TASKS.CHAT,
  hasLargeContext = false,
}) {
  const normalizedTier =
    normalizeTier(userTier);

  log("Selecting model", {
    userTier: normalizedTier,
    task,
    hasLargeContext,
  });

  let selectedModel =
    MODEL_ROUTING?.[
      normalizedTier
    ]?.[task];

  /* =====================================================
     Large context upgrade rule
  ===================================================== */

  if (
    hasLargeContext &&
    normalizedTier !==
      USER_TIERS.FREE
  ) {
    selectedModel =
      AI_MODELS.PRO;

    log(
      "Large context detected → upgraded to PRO"
    );
  }

  /* =====================================================
     Fallback protection
  ===================================================== */

  if (!selectedModel) {
    selectedModel =
      AI_MODELS.FLASH;

    log(
      "Fallback model applied",
      {
        selectedModel,
      }
    );
  }

  log("Model selected", {
    selectedModel,
  });

  return selectedModel;
}

/* =========================================================
   Get Context Limits
========================================================= */

export function getContextLimits(
  userTier = USER_TIERS.FREE
) {
  const normalizedTier =
    normalizeTier(userTier);

  const limits =
    CONTEXT_LIMITS[
      normalizedTier
    ] ||
    CONTEXT_LIMITS.free;

  log("Context limits selected", {
    userTier: normalizedTier,
    limits,
  });

  return limits;
}

/* =========================================================
   Determine Task Type
========================================================= */

export function determineTaskType({
  query = "",
  extraContext = "",
}) {
  const normalizedQuery =
    query.toLowerCase();

  const hasLargeDocument =
    extraContext.length > 3000;

  if (hasLargeDocument) {
    log(
      "Task classified as DOCUMENT_ANALYSIS"
    );

    return AI_TASKS.DOCUMENT_ANALYSIS;
  }

  const reasoningKeywords = [
    "analyze",
    "explain",
    "compare",
    "interpret",
    "legal implications",
    "lawsuit",
    "court",
    "rights",
    "defend",
  ];

  const isReasoningTask =
    reasoningKeywords.some(
      (keyword) =>
        normalizedQuery.includes(
          keyword
        )
    );

  if (isReasoningTask) {
    log(
      "Task classified as LEGAL_REASONING"
    );

    return AI_TASKS.LEGAL_REASONING;
  }

  log("Task classified as CHAT");

  return AI_TASKS.CHAT;
}

/* =========================================================
   Embedding Model
========================================================= */

export function getEmbeddingModel() {
  return AI_MODELS.EMBEDDING;
}