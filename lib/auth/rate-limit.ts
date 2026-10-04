/**
 * Slows down password guessing: at most `max` attempts per key (email or
 * address) in a sliding window. Kept in memory; one server process.
 */
export function createRateLimiter(max = 10, windowMs = 15 * 60_000) {
  const hits = new Map<string, number[]>();
  return {
    /** Returns true if the attempt is allowed (and records it). */
    allow(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}
