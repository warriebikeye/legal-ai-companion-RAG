import redis from "../services/redis.js";

/* =========================================================
   ACQUIRE LOCK
========================================================= */

export async function acquireLock(
  key,
  ttl = 300
) {
  const result = await redis.set(
    key,
    "1",
    {
      NX: true,
      EX: ttl,
    }
  );

  return result === "OK";
}

/* =========================================================
   RELEASE LOCK
========================================================= */

export async function releaseLock(
  key
) {
  await redis.del(key);
}