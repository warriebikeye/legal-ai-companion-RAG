const queryCache = new Map();

// TTL = 1 hour
const TTL = 1000 * 60 * 60;

export function getCachedAnswer(key) {
  const entry = queryCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > TTL) {
    queryCache.delete(key); // expired
    return null;
  }

  return entry.answer;
}

export function setCachedAnswer(key, answer) {
  queryCache.set(key, {
    answer,
    timestamp: Date.now()
  });
}
