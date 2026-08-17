//documentExpiry.queue.js
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(
  process.env.REDIS_URL,
  {
    maxRetriesPerRequest: null,
  }
);

// Delayed jobs only (deletion is scheduled `delay: GENERATED_DOC_TTL_MS` into
// the future by documentGeneration.service.js) — Redis-persisted, so a
// worker restart mid-delay doesn't lose the scheduled deletion. The periodic
// sweep in generatedDocumentCleanup.service.js is the backstop for anything
// this misses (a manually flushed queue, etc.).
export const documentExpiryQueue =
  new Queue("document-expiry", {
    connection,
    defaultJobOptions: {
      attempts: 3,

      backoff: {
        type: "exponential",
        delay: 3000,
      },

      removeOnComplete: 100,

      removeOnFail: 500,
    },
  });
