/* =========================================================
   Model Router
========================================================= */

export function selectModel({
  userTier = "free",
  taskType = "chat",
  contextLength = 0,
}) {
  /* =========================================
     Embeddings
  ========================================= */

  if (
    taskType === "embedding"
  ) {
    return "gemini-embedding-001";
  }

  /* =========================================
     Cheap operations always use Flash
  ========================================= */

  if (
    taskType === "summary" ||
    taskType === "classification"
  ) {
    return "gemini-2.5-flash";
  }

  /* =========================================
     Enterprise
  ========================================= */

  if (
    userTier === "enterprise"
  ) {
    return "gemini-2.5-pro";
  }

  /* =========================================
     Premium
  ========================================= */

  if (
    userTier === "premium"
  ) {
    return "gemini-2.5-pro";
  }

  /* =========================================
     Large contexts
  ========================================= */

  if (contextLength > 12000) {
    return "gemini-2.5-pro";
  }

  /* =========================================
     Default
  ========================================= */

  return "gemini-2.5-flash";
}