// src/services/generatedDocumentCleanup.service.js
//
// Safety-net sweep for expired generated documents, mirroring
// vectorCleanup.service.js's pattern. The primary deletion mechanism is
// the BullMQ delayed job scheduled in documentGeneration.service.js
// (fires almost exactly at expiresAt); this sweep mops up anything that
// job missed (a flushed queue, a job removed out of band, etc.).

import GeneratedDocument from "../models/GeneratedDocument.js";
import { deleteRawDocument } from "../utils/cloudinary.js";

const CLEANUP_BATCH_SIZE = 100;

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[GENERATED_DOC_CLEANUP] [${timestamp}] ${step}`, data);
  } else {
    console.log(`[GENERATED_DOC_CLEANUP] [${timestamp}] ${step}`);
  }
}

export async function sweepExpiredGeneratedDocuments() {
  const started = Date.now();

  try {
    log("Expired generated-document sweep started");

    const expired = await GeneratedDocument.find({
      status: "completed",
      expiresAt: { $lt: new Date() },
      deletedAt: null,
    }).limit(CLEANUP_BATCH_SIZE);

    if (!expired.length) {
      log("No expired generated documents found");
      return;
    }

    log("Expired generated documents found", { count: expired.length });

    for (const doc of expired) {
      try {
        if (doc.resultPublicId) {
          try {
            await deleteRawDocument(doc.resultPublicId);
          } catch (err) {
            if (err?.http_code !== 404) throw err;
          }
        }
        doc.status = "expired";
        doc.deletedAt = new Date();
        await doc.save();
      } catch (err) {
        console.error("❌ Failed to sweep-clean a generated document", {
          generatedDocumentId: doc._id.toString(),
          message: err?.message,
        });
      }
    }

    log("Expired generated documents cleaned", {
      count: expired.length,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    console.error("❌ Generated document sweep failed", {
      message: err?.message,
      stack: err?.stack,
    });
  }
}
