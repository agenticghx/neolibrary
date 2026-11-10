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
export type VisitorKind = keyof typeof VISITOR_LIMITS;

const windows = new Map<string, { count: number; resetAt: number }>();
/** Past this many addresses, windows that have ended are dropped (memory stays small). */
const PRUNE_AT = 10_000;

/** The visitor's address: the first one in x-forwarded-for (Railway's edge sets it), else a shared "unknown". */
export function visitorAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Counts one request; says whether it is allowed and, if not, how many seconds until it would be. */
export function takeVisitorRequest(kind: VisitorKind, address: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const { max, windowMs } = VISITOR_LIMITS[kind];
  const key = `${kind}\0${address}`;
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size >= PRUNE_AT) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
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
