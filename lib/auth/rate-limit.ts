/**
 * Slows down password guessing: at most `max` attempts per key (an email, an
 * address, or both together) in a sliding window. Kept in memory; one server
 * process. A key not tried within the window is forgotten: once the map holds
 * `sweepAt` keys, the stale ones are dropped, so a stream of made-up emails
 * does not grow the memory without end.
 */
export function createRateLimiter(max = 10, windowMs = 15 * 60_000, sweepAt = 1000) {
  const hits = new Map<string, number[]>();
  const maxKeys = Math.max(sweepAt * 4, 4000);
  let lastSweep = -Infinity;
  const sweep = (now: number) => {
    lastSweep = now;
    for (const [key, times] of hits) if (!times.length || now - times[times.length - 1] >= windowMs) hits.delete(key);
  };
  const evictIfFull = () => {
    while (hits.size >= maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  };
  return {
    /** Returns true if the key still has room in the window without recording an attempt. */
    peek(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      return recent.length < max;
    },
    /** Returns true if the attempt is allowed (and records it). */
    allow(key: string, now = Date.now()): boolean {
      if (hits.size >= sweepAt && now - lastSweep >= Math.min(10_000, Math.max(1, Math.floor(windowMs / 4)))) sweep(now);
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      hits.delete(key);
      if (recent.length >= max) {
        if (recent.length) {
          evictIfFull();
          hits.set(key, recent);
        }
        return false;
      }
      recent.push(now);
      evictIfFull();
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
