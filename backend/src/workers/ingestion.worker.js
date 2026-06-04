import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import IORedis from "ioredis";
import { processUploadedDocuments } from "../services/documentProcessor.service.js";

console.log("REDIS_URL exists:", !!process.env.REDIS_URL);

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: {
    rejectUnauthorized: false,
  },
});

const worker = new Worker(
  "document-ingestion",
  async (job) => {
    const { files, userId, conversationId } = job.data;

    console.log("[WORKER] Processing ingestion job");

    // ✅ CRITICAL FIX: decode buffer here
    const normalizedFiles = files.map((f) => ({
      ...f,
      buffer: f.buffer ? Buffer.from(f.buffer, "base64") : null,
    }));

    await processUploadedDocuments({
      files: normalizedFiles,
      userId,
      conversationId,
    });

    console.log("[WORKER] Ingestion completed");
  },
  {
    connection,
    concurrency: 3,
  }
);

console.log("🚀 Ingestion worker started");

worker.on("completed", (job) => {
  console.log(`[WORKER] Job completed ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[WORKER] Job failed ${job?.id}`, err);
});