import {
  ingestionQueue,
} from "../queue/ingestion.queue.js";

import {
  PERFORMANCE_CONFIG,
} from "../config/performance.config.js";

/* =========================================================
   LOGGER
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[QUEUE_MONITOR] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[QUEUE_MONITOR] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   CHECK QUEUE HEALTH
========================================================= */

export async function checkQueueCapacity() {
  try {
    const [
      waiting,
      active,
      delayed,
    ] = await Promise.all([
      ingestionQueue.getWaitingCount(),

      ingestionQueue.getActiveCount(),

      ingestionQueue.getDelayedCount(),
    ]);

    const overloaded =
      waiting >=
        PERFORMANCE_CONFIG.MAX_QUEUE_WAITING ||
      active >=
        PERFORMANCE_CONFIG.MAX_QUEUE_ACTIVE;

    log("Queue stats", {
      waiting,
      active,
      delayed,
      overloaded,
    });

    return {
      overloaded,

      stats: {
        waiting,
        active,
        delayed,
      },
    };
  } catch (err) {
    console.error(
      "❌ Queue monitor failed:",
      err
    );

    return {
      overloaded: false,

      stats: {
        waiting: 0,
        active: 0,
        delayed: 0,
      },
    };
  }
}