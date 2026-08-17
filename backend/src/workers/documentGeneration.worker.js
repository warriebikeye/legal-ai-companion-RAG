//documentGeneration.worker.js
import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import IORedis from "ioredis";
import { generateRevisedDocument } from "../services/documentGeneration.service.js";

console.log("REDIS_URL exists:", !!process.env.REDIS_URL);

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: {
    rejectUnauthorized: false,
  },
});

const worker = new Worker(
  "document-generation",
  async (job) => {
    const { generatedDocumentId } = job.data;

    console.log("[WORKER] Processing document-generation job", generatedDocumentId);

    await generateRevisedDocument(generatedDocumentId);

    console.log("[WORKER] Document generation completed", generatedDocumentId);
  },
  {
    connection,
    concurrency: 3,
  }
);

console.log("🚀 Document generation worker started");

worker.on("completed", (job) => {
  console.log(`[WORKER] Job completed ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[WORKER] Job failed ${job?.id}`, err);
});
