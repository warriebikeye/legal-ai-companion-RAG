//documentExpiry.worker.js
import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import IORedis from "ioredis";
import GeneratedDocument from "../models/GeneratedDocument.js";
import { deleteRawDocument } from "../utils/cloudinary.js";

console.log("REDIS_URL exists:", !!process.env.REDIS_URL);

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: {
    rejectUnauthorized: false,
  },
});

const worker = new Worker(
  "document-expiry",
  async (job) => {
    const { generatedDocumentId } = job.data;

    console.log("[WORKER] Processing document-expiry job", generatedDocumentId);

    const doc = await GeneratedDocument.findById(generatedDocumentId);
    if (!doc || doc.deletedAt) {
      console.log("[WORKER] Already deleted or missing, skipping", generatedDocumentId);
      return;
    }

    if (doc.resultPublicId) {
      try {
        await deleteRawDocument(doc.resultPublicId);
      } catch (err) {
        // Cloudinary returning "not found" for an already-gone asset is
        // fine — anything else should still fail the job so BullMQ retries.
        if (err?.http_code !== 404) throw err;
      }
    }

    doc.status = "expired";
    doc.deletedAt = new Date();
    await doc.save();

    console.log("[WORKER] Generated document expired and deleted", generatedDocumentId);
  },
  {
    connection,
    concurrency: 5,
  }
);

console.log("🚀 Document expiry worker started");

worker.on("completed", (job) => {
  console.log(`[WORKER] Job completed ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[WORKER] Job failed ${job?.id}`, err);
});
