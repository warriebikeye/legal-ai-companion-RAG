// src/controllers/adminStream.controller.js
//
// SSE endpoint: GET /admin/stream
// Pushes dashboard stat updates to the frontend in real time.
//
// Event sequence:
//   data: {"type":"snapshot","payload":{...fullStats}}   ← on connect
//   data: {"type":"queue","payload":{...queueStats}}     ← every 5s
//   data: {"type":"users","payload":{total,premium,...}} ← every 60s
//   data: {"type":"error","payload":"message"}           ← on failure
//
// The frontend replaces its setInterval polling with a single EventSource.

import { getDashboardStats } from "../services/adminStats.service.js";
import { ingestionQueue } from "../queue/ingestion.queue.js";

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[ADMIN_STREAM] [${timestamp}] ${step}`, data)
    : console.log(`[ADMIN_STREAM] [${timestamp}] ${step}`);
}

export async function streamDashboard(req, res) {
  log("Admin SSE connection opened", { adminId: req.user?._id });

  /* -------------------------------------------------------
     SSE HEADERS
  ------------------------------------------------------- */

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (type, payload) => {
    try {
      res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
    } catch {
      // Client gone
    }
  };

  // Keep-alive ping
  const keepAlive = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(keepAlive); }
  }, 20000);

  /* -------------------------------------------------------
     INITIAL FULL SNAPSHOT
  ------------------------------------------------------- */

  try {
    const snapshot = await getDashboardStats();
    send("snapshot", snapshot);
    log("Initial snapshot sent");
  } catch (err) {
    send("error", "Failed to load initial stats");
    log("Snapshot failed", { error: err?.message });
  }

  /* -------------------------------------------------------
     QUEUE POLL — every 5s (lightweight, no DB)
  ------------------------------------------------------- */

  const queuePoll = setInterval(async () => {
    try {
      const [waiting, active, delayed, failed, completed] = await Promise.all([
        ingestionQueue.getWaitingCount(),
        ingestionQueue.getActiveCount(),
        ingestionQueue.getDelayedCount(),
        ingestionQueue.getFailedCount(),
        ingestionQueue.getCompletedCount(),
      ]);

      const failedJobs = await ingestionQueue.getFailed(0, 4);

      send("queue", {
        waiting,
        active,
        delayed,
        failed,
        completed,
        overloaded: waiting >= 40 || active >= 10,
        status: waiting >= 40 || active >= 10 ? "overloaded" : "healthy",
        recentFailures: failedJobs.map((j) => ({
          id: j.id,
          name: j.name,
          failedReason: j.failedReason,
          attemptsMade: j.attemptsMade,
          timestamp: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        })),
      });
    } catch (err) {
      log("Queue poll error", { error: err?.message });
    }
  }, 5000);

  /* -------------------------------------------------------
     FULL STATS REFRESH — every 60s
     Busts Redis cache so numbers stay fresh.
  ------------------------------------------------------- */

  const statsPoll = setInterval(async () => {
    try {
      const stats = await getDashboardStats();
      send("snapshot", stats);
      log("Periodic snapshot sent");
    } catch (err) {
      log("Stats poll error", { error: err?.message });
    }
  }, 60000);

  /* -------------------------------------------------------
     CLEANUP on client disconnect
  ------------------------------------------------------- */

  req.on("close", () => {
    clearInterval(keepAlive);
    clearInterval(queuePoll);
    clearInterval(statsPoll);
    log("Admin SSE connection closed", { adminId: req.user?._id });
    res.end();
  });
}