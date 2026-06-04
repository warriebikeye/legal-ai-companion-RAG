// src/workers/vectorCleanup.worker.js

import {
  cleanupExpiredVectors,
} from "../services/vectorCleanup.service.js";

/* =========================================================
   CONFIG
========================================================= */

const CLEANUP_INTERVAL_MS =
  1000 * 60 * 10;

/* =========================================================
   START CLEANUP WORKER
========================================================= */

export function startVectorCleanupWorker() {
  console.log(
    "🧹 Vector cleanup worker started"
  );

  /* =====================================================
     RUN IMMEDIATELY
  ===================================================== */

  cleanupExpiredVectors();

  /* =====================================================
     RUN PERIODICALLY
  ===================================================== */

  setInterval(async () => {
    await cleanupExpiredVectors();
  }, CLEANUP_INTERVAL_MS);
}