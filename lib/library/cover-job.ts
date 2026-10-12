import { getCoverSource, type CoverSource } from "@/lib/covers/sources";
import type { Db } from "@/lib/db/client";
import type { Storage } from "@/lib/storage";
import { findMissingCovers, type LookupProgress, type LookupResult } from "./cover-lookup";

/**
 * Runs cover lookups in the background (M22), one run at a time in this
 * server: a while after it starts and every six hours, for every reader's
 * titles without a cover (so titles added since are covered too), and when a
 * reader asks for one. COVER_LOOKUP=off switches the automatic runs off (the
 * browser tests, so covers do not appear on the pages they photograph).
 */

type Run = { promise: Promise<LookupResult>; ownerId: string | null; progress: LookupProgress };

const g = globalThis as unknown as { __neolibraryCoverRun?: Run | null; __neolibraryCoverTimers?: boolean };

/** The run in progress, if any: for everyone (ownerId null) or for one reader. */
export const currentCoverRun = () => g.__neolibraryCoverRun ?? null;

/** Starts a run unless one is going; returns the run in progress either way. */
export function startCoverRun(
  db: Db,
  storage: Storage,
  opts: { ownerId?: string; force?: boolean; source?: CoverSource; now?: () => Date } = {},
): Run {
  const going = currentCoverRun();
  if (going) return going;
  const progress: LookupProgress = { done: 0, total: 0, found: 0 };
  const run: Run = {
    ownerId: opts.ownerId ?? null,
    progress,
    promise: findMissingCovers(db, storage, opts.source ?? getCoverSource(), {
      ownerId: opts.ownerId,
      force: opts.force,
      now: opts.now,
      onProgress: (p) => Object.assign(progress, p),
    }).finally(() => {
      if (g.__neolibraryCoverRun === run) g.__neolibraryCoverRun = null;
    }),
  };
  g.__neolibraryCoverRun = run;
  return run;
}

const START_DELAY_MS = 20_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

/** Called once when the server starts (instrumentation.ts). */
export function scheduleCoverLookups(getDb: () => Promise<Db>, getStorage: () => Promise<Storage>, env: Record<string, string | undefined> = process.env) {
  if (env.COVER_LOOKUP === "off" || g.__neolibraryCoverTimers) return;
  g.__neolibraryCoverTimers = true;
  const tick = async () => {
    try {
      const r = await startCoverRun(await getDb(), await getStorage()).promise;
      if (r.total) console.log(`  Covers: looked up ${r.done} of ${r.total} title(s) without one, found ${r.found}${r.stopped ? " (stopped: a catalogue could not be reached)" : ""}.`);
    } catch (e) {
      console.error("Cover lookup failed", e);
    }
  };
  // unref: the timers never keep the process alive on their own (a test runner, a shutdown).
  const unref = (t: unknown) => (t as { unref?: () => void }).unref?.();
  unref(setTimeout(() => void tick(), START_DELAY_MS));
  unref(setInterval(() => void tick(), EVERY_MS));
}
