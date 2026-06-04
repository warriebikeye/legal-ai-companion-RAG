// src/services/vectorCleanup.service.js

import {
  qdrant,
  USER_DOCS_COLLECTION,
} from "../vectorstore/qdrant.js";

/* =========================================================
   CONFIG
========================================================= */

const CLEANUP_BATCH_SIZE = 1000;

/* =========================================================
   LOGGER
========================================================= */

function log(step, data = null) {
  const timestamp =
    new Date().toISOString();

  if (data) {
    console.log(
      `[VECTOR_CLEANUP] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[VECTOR_CLEANUP] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   CLEAN EXPIRED VECTORS
========================================================= */

export async function cleanupExpiredVectors() {
  const started =
    Date.now();

  try {
    log(
      "Expired vector cleanup started"
    );

    const now =
      new Date().toISOString();

    /* =====================================================
       FIND EXPIRED VECTORS
    ===================================================== */

    const scrollResult =
      await qdrant.scroll(
        USER_DOCS_COLLECTION,
        {
          limit:
            CLEANUP_BATCH_SIZE,

          with_payload: false,

          with_vector: false,

          filter: {
            must: [
              {
                key:
                  "expiresAt",

                range: {
                  lt: now,
                },
              },
            ],
          },
        }
      );

    const points =
      scrollResult.points || [];

    if (!points.length) {
      log(
        "No expired vectors found"
      );

      return;
    }

    const pointIds =
      points.map(
        (point) => point.id
      );

    log(
      "Expired vectors found",
      {
        count:
          pointIds.length,
      }
    );

    /* =====================================================
       DELETE EXPIRED VECTORS
    ===================================================== */

    await qdrant.delete(
      USER_DOCS_COLLECTION,
      {
        points:
          pointIds,
      }
    );

    log(
      "Expired vectors deleted",
      {
        deleted:
          pointIds.length,

        durationMs:
          Date.now() -
          started,
      }
    );
  } catch (err) {
    console.error(
      "❌ Vector cleanup failed",
      {
        message:
          err?.message,

        stack:
          err?.stack,
      }
    );
  }
}  