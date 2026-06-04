import { QueueEvents } from "bullmq";

import IORedis from "ioredis";

const connection = new IORedis(
  process.env.REDIS_URL,
  {
    maxRetriesPerRequest: null,
  }
);

export const ingestionQueueEvents =
  new QueueEvents(
    "document-ingestion",
    {
      connection,
    }
  );