// utils/metrics.js
//
// Lightweight Redis-backed counters for the admin dashboard.
// Drop these calls into your existing services:
//
//   gemini.js  → after successful getAnswer():    trackModelCall(modelName)
//   gemini.js  → after successful getAnswer():    trackLatency(latencyMs)
//   rag.service.js → after getRAGAnswer():        trackLatency(latencyMs)
//
// No external deps — uses the same redis client you already have.

import redis from "../services/redis.js";

const MODEL_USAGE_KEY = "metrics:model_usage";
const LATENCY_KEY     = "metrics:latency";
const LATENCY_MAX     = 500; // ring buffer — keep last 500 samples

/* =========================================================
   Track a model call (increments HINCRBY counter)
========================================================= */

export async function trackModelCall(modelName) {
  try {
    await redis.hincrby(MODEL_USAGE_KEY, modelName, 1);
  } catch (err) {
    // Non-fatal — never let metrics break the hot path
    console.warn("[METRICS] trackModelCall failed:", err?.message);
  }
}

/* =========================================================
   Track response latency (lpush into a capped list)
========================================================= */

export async function trackLatency(latencyMs) {
  try {
    await redis.lpush(LATENCY_KEY, latencyMs);
    await redis.ltrim(LATENCY_KEY, 0, LATENCY_MAX - 1);
  } catch (err) {
    console.warn("[METRICS] trackLatency failed:", err?.message);
  }
}

/* =========================================================
   Example — add to gemini.js getAnswer() on success:

   import { trackModelCall, trackLatency } from "../utils/metrics.js";

   // inside the try block, after `const response = ...`
   trackModelCall(modelName);   // fire-and-forget
   trackLatency(Date.now() - started);
========================================================= */