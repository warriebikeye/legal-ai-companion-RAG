export const PERFORMANCE_CONFIG = {
  /* =========================================================
     DOCUMENT PROCESSING
  ========================================================= */

  DOCUMENT_TTL:
    Number(process.env.DOCUMENT_TTL) ||
    86400,

  EXTRACTION_CACHE_TTL:
    Number(
      process.env.EXTRACTION_CACHE_TTL
    ) || 86400,

  /* =========================================================
     EMBEDDINGS
  ========================================================= */

  EMBEDDING_TIMEOUT_MS:
    Number(
      process.env.EMBEDDING_TIMEOUT_MS
    ) || 30000,

  EMBEDDING_CONCURRENCY:
    Number(
      process.env.EMBEDDING_CONCURRENCY
    ) || 5,

  /* =========================================================
     RETRIEVAL
  ========================================================= */

  DEFAULT_TOP_K:
    Number(process.env.DEFAULT_TOP_K) ||
    5,

  MIN_SIMILARITY:
    Number(
      process.env.MIN_SIMILARITY
    ) || 0.7,

  /* =========================================================
     BULLMQ
  ========================================================= */

  WORKER_CONCURRENCY:
    Number(
      process.env.WORKER_CONCURRENCY
    ) || 3,

  QUEUE_ATTEMPTS:
    Number(
      process.env.QUEUE_ATTEMPTS
    ) || 3,

  QUEUE_BACKOFF_MS:
    Number(
      process.env.QUEUE_BACKOFF_MS
    ) || 3000,

  /* =========================================================
     BACKPRESSURE
  ========================================================= */

  MAX_QUEUE_WAITING:
    Number(
      process.env.MAX_QUEUE_WAITING
    ) || 1000,

  MAX_QUEUE_ACTIVE:
    Number(
      process.env.MAX_QUEUE_ACTIVE
    ) || 200,

  /* =========================================================
     RATE LIMITING
  ========================================================= */

  API_RATE_LIMIT_WINDOW_MS:
    Number(
      process.env.API_RATE_LIMIT_WINDOW_MS
    ) || 60000,

  API_RATE_LIMIT_MAX:
    Number(
      process.env.API_RATE_LIMIT_MAX
    ) || 100,

  /* =========================================================
     CIRCUIT BREAKER
  ========================================================= */

  GEMINI_FAILURE_THRESHOLD:
    Number(
      process.env.GEMINI_FAILURE_THRESHOLD
    ) || 5,

  GEMINI_RECOVERY_TIMEOUT_MS:
    Number(
      process.env
        .GEMINI_RECOVERY_TIMEOUT_MS
    ) || 60000,
};