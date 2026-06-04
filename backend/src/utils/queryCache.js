import crypto from "crypto";

export function generateQueryCacheKey({
  query,
  conversationId,
  country,
  retrievalMode,
}) {
  const normalized =
    JSON.stringify({
      query:
        query
          ?.trim()
          ?.toLowerCase(),

      conversationId,

      country,

      retrievalMode,
    });

  const hash =
    crypto
      .createHash("sha256")
      .update(normalized)
      .digest("hex");

  return `query_cache:${hash}`;
}