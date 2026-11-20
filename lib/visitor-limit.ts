/*
 * M34 S5: a limit on requests per visitor (someone not signed in) to the open shelf, its files and the AI routes a
 * visitor may use. A fixed window per address and kind: when a window is used up the visitor is told to wait. The
 * counts live in this server process only (Neolibrary runs one), so a restart forgets them; that is fine for a
 * guard against a script hammering the site, which is what it is for. On /browse pages the signed-in are counted too (proxy.ts); elsewhere signed-in people are never limited here.
 */
export const VISITOR_LIMITS = {
  /** Pages: the shelf, a book's page, the reader. */
  page: { max: 120, windowMs: 60_000 },
  /** Files: covers (a shelf page shows every cover) and a free book's file. */
  file: { max: 1200, windowMs: 60_000 },
  /** AI routes (saved answers, or a new one on the visitor's own key). */
  ai: { max: 30, windowMs: 60_000 },
} as const;
type VisitorKind = keyof typeof VISITOR_LIMITS;

const windows = new Map<string, { count: number; resetAt: number }>();
/** Past this many addresses, windows that have ended are dropped (memory stays small). */
const PRUNE_AT = 10_000;
const MAX_WINDOWS = 40_000;
let lastPrune = -Infinity;

/**
 * The visitor's address, for the limits here and on sign-in: X-Real-IP, the header Railway's edge documents for the
 * client's address; else the first x-forwarded-for value (local and test servers); else a shared "unknown".
 * Measured on the live site on 2026-11-14: counted by x-forwarded-for, the limit never refused a script that opened a
 * new connection per request (130 of 130 allowed), so that header changes with the connection there.
 */
export function visitorAddress(headers: Pick<Headers, "get">): string {
  return headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Counts one request; says whether it is allowed and, if not, how many seconds until it would be. */
export function takeVisitorRequest(kind: VisitorKind, address: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const { max, windowMs } = VISITOR_LIMITS[kind];
  const key = `${kind}\0${address}`;
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.delete(key);
    if (windows.size >= PRUNE_AT && now - lastPrune >= 5_000) {
      lastPrune = now;
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    while (windows.size >= MAX_WINDOWS) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  if (w.count <= max) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
}

/** Forgets every count. Tests only. */
export function resetVisitorLimitsForTests() {
  windows.clear();
}
