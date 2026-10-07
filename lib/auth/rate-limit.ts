/**
 * Slows down password guessing: at most `max` attempts per key (an email, an
 * address, or both together) in a sliding window. Kept in memory; one server
 * process. A key not tried within the window is forgotten: once the map holds
 * `sweepAt` keys, the stale ones are dropped, so a stream of made-up emails
 * does not grow the memory without end.
 */
export function createRateLimiter(max = 10, windowMs = 15 * 60_000, sweepAt = 1000) {
  const hits = new Map<string, number[]>();
  const sweep = (now: number) => {
    for (const [key, times] of hits) if (!times.length || now - times[times.length - 1] >= windowMs) hits.delete(key);
  };
  return {
    /** Returns true if the attempt is allowed (and records it). */
    allow(key: string, now = Date.now()): boolean {
      if (hits.size >= sweepAt) sweep(now);
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
    /** How many keys are remembered (for tests). */
    size: () => hits.size,
  };
}
