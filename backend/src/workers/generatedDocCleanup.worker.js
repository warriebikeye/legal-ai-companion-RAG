// src/workers/generatedDocCleanup.worker.js

import { sweepExpiredGeneratedDocuments } from "../services/generatedDocumentCleanup.service.js";

/* =========================================================
   CONFIG
========================================================= */

const CLEANUP_INTERVAL_MS = 1000 * 60 * 5;

/* =========================================================
   START CLEANUP WORKER
========================================================= */

export function startGeneratedDocCleanupWorker() {
  console.log("🧹 Generated-document cleanup worker started");

  sweepExpiredGeneratedDocuments();

  setInterval(async () => {
    await sweepExpiredGeneratedDocuments();
  }, CLEANUP_INTERVAL_MS);
}
