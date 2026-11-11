import { and, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";
import { SMALL_FILE_CACHE_BYTES } from "@/lib/storage/small-file-cache";

/**
 * Keeps every book's cover in the server's memory (lib/storage/small-file-cache.ts), so no visit finds it empty.
 *
 * Why: measured on the live open shelf on 2026-11-11. With the covers in memory, Safari's engine (WebKit) fetched all
 * 129 in about 3.2 s. With the memory empty (after a deploy, or after the ten quiet minutes a copy used to last),
 * each cover took about 0.45 s from the bucket, WebKit fetched them two at a time, and the same page took 31.6 s.
 *
 * Asking storage for a cover's size is enough: the memory wrapper reads a cover whole the first time it is asked
 * about it, and answers from memory after. Who may have a cover is still decided on every request, by the routes.
 */
export async function warmCovers(
  db: Db,
  storage: Storage,
  opts: { atOnce?: number; maxBytes?: number } = {},
): Promise<{ covers: number; missing: number; bytes: number; leftOut: number }> {
  // Stop short of what the memory holds: past it, each cover read would push another out, and every pass would read
  // them from the bucket again, for ever.
  const maxBytes = opts.maxBytes ?? SMALL_FILE_CACHE_BYTES * 0.9;
  const rows = await db.select({ key: books.coverKey }).from(books).where(and(isNotNull(books.coverKey), isNull(books.deletedAt)));
  const keys = [...new Set(rows.map((r) => r.key!))];
  let next = 0;
  let missing = 0;
  let covers = 0;
  let bytes = 0;
  const worker = async () => {
    while (next < keys.length && bytes < maxBytes) {
      const key = keys[next++];
      const info = await storage.stat(key).catch(() => null);
      if (!info) missing++;
      else {
        covers++;
        bytes += info.size;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.atOnce ?? 8, keys.length) }, worker));
  return { covers, missing, bytes, leftOut: keys.length - covers - missing };
}

const g = globalThis as unknown as { __neolibraryWarmCovers?: boolean };
const EVERY_MS = 10 * 60 * 1000;

/**
 * Called once when the server starts (instrumentation.ts): now, and every ten minutes after. A later pass costs one
 * database query and no trip to the bucket for a cover already kept; it reads the covers added since (a script, another
 * server) and the ones whose copy has aged out.
 */
export function scheduleCoverWarming(getDb: () => Promise<Db>, getStorage: () => Promise<Storage>) {
  if (g.__neolibraryWarmCovers) return;
  g.__neolibraryWarmCovers = true;
  let first = true;
  const tick = async () => {
    try {
      const r = await warmCovers(await getDb(), await getStorage());
      if (first || r.leftOut) {
        const notes = `${r.missing ? `, ${r.missing} not found in storage` : ""}${r.leftOut ? `, ${r.leftOut} left out (the memory is full)` : ""}`;
        console.log(`  Covers: ${r.covers} kept in memory (${(r.bytes / 1024 / 1024).toFixed(1)} MB)${notes}.`);
      }
      first = false;
    } catch (e) {
      console.error("Keeping covers in memory failed", e);
    }
  };
  // unref: the timer never keeps the process alive on its own (a test runner, a shutdown).
  const unref = (t: unknown) => (t as { unref?: () => void }).unref?.();
  void tick();
  unref(setInterval(() => void tick(), EVERY_MS));
}
