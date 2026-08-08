//folderIngestion.worker.js
import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import IORedis from "ioredis";
import fs from "fs/promises";
import path from "path";
import { ingestFolderFile } from "../services/ingest.service.js";
import { releaseLock } from "../utils/distributedLock.js";
import redis from "../services/redis.js";

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[FOLDER_INGEST] [${timestamp}] ${step}`, data)
    : console.log(`[FOLDER_INGEST] [${timestamp}] ${step}`);
}

log("REDIS_URL exists", !!process.env.REDIS_URL);

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: {
    rejectUnauthorized: false,
  },
});

// Concurrency 1: serializes every Gemini embedding call made by this job
// type (across countries too) so a batch of dropped PDFs can't storm the
// API and trigger 429s.
const worker = new Worker(
  "folder-ingestion",
  async (job) => {
    const { country, filePath, fileName, doneDir } = job.data;
    const jobStartedAt = Date.now();

    log("Job started", { jobId: job.id, fileName, country, attempt: job.attemptsMade + 1 });

    const result = await ingestFolderFile({
      filePath,
      originalname: fileName,
      country,
    });

    await fs.mkdir(doneDir, { recursive: true });
    const donePath = path.join(doneDir, fileName);
    await fs.rename(filePath, donePath);

    log("Moved TO -> DONE", { fileName, donePath });
    log(
      result.duplicate ? "Job finished (duplicate skipped)" : "Job finished (ingested)",
      { jobId: job.id, fileName, chunksUploaded: result.chunksUploaded, durationMs: Date.now() - jobStartedAt }
    );

    return result;
  },
  {
    connection,
    concurrency: 1,
  }
);

// Releases the per-country batch lock (and logs a summary) once every file
// enqueued for that country's TO-folder scan has finished, success or
// failure exhausted.
async function markJobDone(slug, lockKey, statsKey, outcome) {
  await redis.hincrby(statsKey, outcome, 1);

  const remainingKey = `folder-ingest-remaining:${slug}`;
  const remaining = await redis.decr(remainingKey);

  if (remaining <= 0) {
    const stats = await redis.hgetall(statsKey);
    log("Batch complete — releasing lock", {
      country: slug,
      succeeded: stats?.succeeded || 0,
      duplicate: stats?.duplicate || 0,
      failed: stats?.failed || 0,
    });

    await redis.del(remainingKey);
    await redis.del(statsKey);
    await releaseLock(lockKey);
  }
}

log("🚀 Folder ingestion worker started");

worker.on("completed", async (job, result) => {
  const { slug, lockKey, statsKey } = job.data;
  const outcome = result?.duplicate ? "duplicate" : "succeeded";
  await markJobDone(slug, lockKey, statsKey, outcome);
});

worker.on("failed", async (job, err) => {
  log("Job failed", { jobId: job?.id, fileName: job?.data?.fileName, error: err?.message });
  if (!job) return;

  // "failed" fires on every retry attempt, not just the final one — only
  // treat the job as done (and release the batch lock) once BullMQ has
  // given up retrying it, so the lock stays held while retries are pending.
  const maxAttempts = job.opts?.attempts || 1;
  if (job.attemptsMade < maxAttempts) return;

  const { slug, lockKey, statsKey } = job.data;
  await markJobDone(slug, lockKey, statsKey, "failed");
});
