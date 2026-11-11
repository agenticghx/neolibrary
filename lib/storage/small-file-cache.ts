import type { Storage } from "./index";

type Kept = { data: Uint8Array; contentType: string; at: number };

/**
 * Keeps small files under one prefix (book covers) in this server's memory after they are first read, so a shelf of
 * covers is not fetched from the bucket one picture at a time on every visit. Measured on the live site on
 * 2026-11-10: a cover took 0.5 to 1.7 s to start arriving, against 0.14 s for a request that never reached the
 * bucket.
 *
 * Who may have a file is still decided on every request, before storage is asked (the routes under /api/files and
 * /api/open/files): this only remembers bytes. A file written or deleted through this storage leaves the memory at
 * once; `ttlMs` bounds how long a copy changed some other way (another server, a script) can be served.
 */
export function withSmallFileCache(
  inner: Storage,
  opts: { prefix?: string; maxFileBytes?: number; maxTotalBytes?: number; ttlMs?: number; now?: () => number } = {},
): Storage {
  const prefix = opts.prefix ?? "covers/";
  // As large as a cover may be where covers are stored (MAX_COVER_BYTES, lib/covers/image.ts): every cover is kept.
  const maxFileBytes = opts.maxFileBytes ?? 3 * 1024 * 1024;
  const maxTotalBytes = opts.maxTotalBytes ?? 64 * 1024 * 1024;
  const ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
  const now = opts.now ?? Date.now;
  // A Map keeps the order of insertion: the first key is the one read longest ago (a read moves its key to the end).
  const kept = new Map<string, Kept>();
  let total = 0;
  // How many times each key has been written or deleted here: a read that began before a change must not keep what
  // it read.
  const changes = new Map<string, number>();
  const changed = (key: string) => {
    if (key.startsWith(prefix)) changes.set(key, (changes.get(key) ?? 0) + 1);
    drop(key);
  };
  /** Reads a file from storage and keeps it, unless it was written or deleted meanwhile. */
  const read = async (key: string) => {
    const before = changes.get(key) ?? 0;
    const file = await inner.get(key);
    if (file && (changes.get(key) ?? 0) === before) keep(key, file);
    return file;
  };

  const drop = (key: string) => {
    const was = kept.get(key);
    if (!was) return;
    total -= was.data.byteLength;
    kept.delete(key);
  };
  const fresh = (key: string) => {
    const hit = kept.get(key);
    if (!hit) return null;
    if (now() - hit.at > ttlMs) {
      drop(key);
      return null;
    }
    kept.delete(key);
    kept.set(key, hit);
    return hit;
  };
  const keep = (key: string, file: { data: Uint8Array; contentType: string }) => {
    drop(key);
    if (file.data.byteLength > maxFileBytes) return;
    kept.set(key, { ...file, at: now() });
    total += file.data.byteLength;
    for (const oldest of kept.keys()) {
      if (total <= maxTotalBytes) break;
      drop(oldest);
    }
  };

  return {
    async get(key) {
      if (!key.startsWith(prefix)) return inner.get(key);
      const hit = fresh(key);
      if (hit) return { data: hit.data, contentType: hit.contentType };
      return read(key);
    },
    async stat(key) {
      if (!key.startsWith(prefix)) return inner.stat(key);
      const hit = fresh(key);
      if (hit) return { size: hit.data.byteLength, contentType: hit.contentType };
      // Not kept yet: read it whole, once, instead of measuring it first. A cover is small (uploads and found covers
      // are capped where they are stored), and the read that follows a stat (lib/serve-file.ts) is then answered from
      // here: one trip to the bucket for a cover's first request, not two.
      const file = await read(key);
      return file ? { size: file.data.byteLength, contentType: file.contentType } : null;
    },
    async put(key, data, contentType) {
      changed(key);
      await inner.put(key, data, contentType);
      changed(key);
    },
    async delete(key) {
      changed(key);
      await inner.delete(key);
      changed(key);
    },
    getRange: (key, start, end) => inner.getRange(key, start, end),
    startUpload: (key, contentType) => inner.startUpload(key, contentType),
    putPart: (key, uploadId, part, data) => inner.putPart(key, uploadId, part, data),
    async finishUpload(key, uploadId, parts) {
      await inner.finishUpload(key, uploadId, parts);
      changed(key);
    },
    abortUpload: (key, uploadId) => inner.abortUpload(key, uploadId),
  };
}
