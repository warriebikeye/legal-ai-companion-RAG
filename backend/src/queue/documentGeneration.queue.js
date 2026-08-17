//documentGeneration.queue.js
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(
  process.env.REDIS_URL,
  {
    maxRetriesPerRequest: null,
  }
);

export const documentGenerationQueue =
  new Queue("document-generation", {
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
