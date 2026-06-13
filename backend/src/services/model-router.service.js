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

  const normalized = String(tier).toLowerCase();

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
   Embedding Model
========================================================= */

export function getEmbeddingModel() {
  return AI_MODELS.EMBEDDING;
}

/* =========================================================
   Model Selection
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

  /* =========================================
     Cheap tasks always use Flash
  ========================================= */

  if (
    task === AI_TASKS.SUMMARIZATION ||
    task === AI_TASKS.CLASSIFICATION
  ) {
    selectedModel = AI_MODELS.FLASH;

    log(
      "Cheap task detected → forcing FLASH"
    );
  }

  /* =========================================
     Large context upgrade rule
  ========================================= */

  if (
    hasLargeContext &&
    normalizedTier !== USER_TIERS.FREE
  ) {
    selectedModel = AI_MODELS.PRO;

    log(
      "Large context detected → upgraded to PRO"
    );
  }

  /* =========================================
     Enterprise always PRO
  ========================================= */

  if (
    normalizedTier === USER_TIERS.ENTERPRISE
  ) {
    selectedModel = AI_MODELS.PRO;

    log(
      "Enterprise tier → forcing PRO"
    );
  }

  /* =========================================
     Fallback protection
  ========================================= */

  if (!selectedModel) {
    selectedModel = AI_MODELS.FLASH;

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
   Context Limits
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
   Task Detection
========================================================= */

export function determineTaskType({
  query = "",
  extraContext = "",
}) {
  const normalizedQuery =
    query.toLowerCase();

  const hasLargeDocument =
    extraContext.length > 3000;

  /* =========================================
     Large uploaded documents
  ========================================= */

  if (hasLargeDocument) {
    log(
      "Task classified as DOCUMENT_ANALYSIS"
    );

    return AI_TASKS.DOCUMENT_ANALYSIS;
  }

  /* =========================================
     Summaries
  ========================================= */

  const summaryKeywords = [
    "summarize",
    "summary",
    "tl;dr",
    "briefly explain",
    "short version",
  ];

  if (
    summaryKeywords.some((keyword) =>
      normalizedQuery.includes(keyword)
    )
  ) {
    log(
      "Task classified as SUMMARIZATION"
    );

    return AI_TASKS.SUMMARIZATION;
  }

  /* =========================================
     Classification
  ========================================= */

  const classificationKeywords = [
    "classify",
    "categorize",
    "label",
    "group into",
    "identify category",
  ];

  if (
    classificationKeywords.some((keyword) =>
      normalizedQuery.includes(keyword)
    )
  ) {
    log(
      "Task classified as CLASSIFICATION"
    );

    return AI_TASKS.CLASSIFICATION;
  }

  /* =========================================
     Legal reasoning
  ========================================= */

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
    "liable",
    "liability",
    "breach",
    "contract",
    "damages",
    "legal opinion",
  ];

  const isReasoningTask =
    reasoningKeywords.some((keyword) =>
      normalizedQuery.includes(keyword)
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
   Legacy Compatibility
   (Used by any older code that still calls selectModel())
========================================================= */

export function selectModel({
  userTier = USER_TIERS.FREE,
  taskType = AI_TASKS.CHAT,
  contextLength = 0,
}) {
  return getModelForTask({
    userTier,
    task: taskType,
    hasLargeContext: contextLength > 12000,
  });
}