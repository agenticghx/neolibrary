import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { audioTracks, books, readalongImports, type ReadalongAudio, type ReadalongPending } from "@/lib/db/schema";
import { getSections } from "@/lib/library/sections-store";
import type { Storage } from "@/lib/storage";
import { matchToParagraphs } from "./match";
import { checkPackage, isForBook, PackageError, parsePackage, readPackageZip } from "./package";

/**
 * M13 (c2): importing a read-along package into a book.
 *
 * 1. `startImport` takes the package as a zip (scripts, timings, book map,
 *    and the audio too if it is small). It checks the package, checks it was
 *    made from this very book file, and places its words on the book's
 *    paragraphs. Audio not in the zip is then sent in parts.
 * 2. `putAudioPart` stores one part (at most MAX_PART_BYTES).
 * 3. `finishImport` joins the parts, checks each audio file against the
 *    package's fingerprint (sha256), and only then makes the read-aloud
 *    tracks: one per paragraph, each a stretch of the long audio file.
 *    A finished import replaces the book's previous one.
 */
export class ReadalongError extends Error {}

/** Parts are 8 MB (the bucket needs at least 5 MB per part, except the last). */
export const PART_BYTES = 8 * 1024 * 1024;
export const MAX_PART_BYTES = 16 * 1024 * 1024;
/** At most this many audio files per package (one per chapter is the most a book needs). */
export const MAX_AUDIO_FILES = 300;
/**
 * The package zip sent in one request: scripts and timings (a few MB even for
 * a long book), or a small package with its audio inside (the page's .zip
 * route, for phones). Larger audio goes in 8 MB parts.
 */
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".m4b": "audio/mp4",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
};

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** A stored file's sha256, read 8 MB at a time so a long audiobook never sits in memory whole. */
async function storedSha256(storage: Storage, key: string) {
  const info = await storage.stat(key);
  if (!info) return null;
  const h = createHash("sha256");
  for (let at = 0; at < info.size; at += PART_BYTES) {
    const chunk = await storage.getRange(key, at, Math.min(info.size, at + PART_BYTES) - 1);
    if (!chunk) return null;
    h.update(chunk);
  }
  return h.digest("hex");
}

export type ImportSummary = {
  id: string;
  bookId: string;
  status: "uploading" | "ready";
  title: string | null;
  voice: string | null;
  madeWith: string | null;
  createdAt: string;
  finishedAt: string | null;
  report: { chapters: { n: number; title: string; spokenWords: number; matchedWords: number }[]; paragraphs: number };
  /** Audio files still to be sent in parts. */
  waitingFor: string[];
  /** The last step is running on the server right now. */
  beingFinished: boolean;
};

type Row = typeof readalongImports.$inferSelect;

const summary = (r: Row): ImportSummary => ({
  id: r.id,
  bookId: r.bookId,
  status: r.status,
  title: r.title,
  voice: r.voice,
  madeWith: r.madeWith,
  createdAt: r.createdAt.toISOString(),
  // finished_at also marks "being finished" while still uploading; report it only once ready.
  finishedAt: r.status === "ready" ? (r.finishedAt?.toISOString() ?? null) : null,
  report: r.report,
  waitingFor: r.status === "ready" ? [] : r.audio.filter((a) => a.uploadId).map((a) => a.file),
  // Someone is finishing it right now (claimed within the last 15 minutes).
  beingFinished: r.status === "uploading" && r.finishedAt !== null && r.finishedAt.getTime() > Date.now() - 15 * 60 * 1000,
});

async function ownedBook(db: Db, ownerId: string, bookId: string) {
  const [book] = await db.select().from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new ReadalongError("Book not found");
  return book;
}

async function ownedImport(db: Db, ownerId: string, bookId: string, importId: string) {
  const [row] = await db
    .select()
    .from(readalongImports)
    .where(and(eq(readalongImports.id, importId), eq(readalongImports.ownerId, ownerId), eq(readalongImports.bookId, bookId)));
  if (!row) throw new ReadalongError("Import not found");
  return row;
}

export async function startImport(db: Db, storage: Storage, ownerId: string, bookId: string, zip: Uint8Array): Promise<ImportSummary> {
  const book = await ownedBook(db, ownerId, bookId);
  if (!book.fileKey) throw new ReadalongError("This book has no file to read along with.");
  if (zip.byteLength > MAX_ZIP_BYTES) throw new ReadalongError("The package is too large to send in one piece (over 50 MB); choose its folder instead, so the audio goes in parts.");
  let files: Record<string, Uint8Array>;
  let pkg;
  try {
    files = readPackageZip(zip);
    pkg = parsePackage(files);
  } catch (e) {
    if (e instanceof PackageError) throw new ReadalongError(`This is not a read-along package: ${e.message.replace(/\.$/, "")}.`);
    throw e;
  }
  const inZip = Object.fromEntries(Object.entries(files).filter(([n]) => pkg.manifest.audio.some((a) => a.file === n)));
  const verdict = checkPackage(pkg, { audio: inZip });
  if (!verdict.ok) throw new ReadalongError(`This package has problems: ${verdict.errors.slice(0, 3).join("; ")}.`);
  const bookFile = await storage.get(book.fileKey);
  if (!bookFile || !isForBook(pkg, bookFile.data)) {
    throw new ReadalongError("This package was made from a different file of this book (the fingerprints differ). Make it again from the file in your library.");
  }

  const paragraphs = (await getSections(db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
  const match = matchToParagraphs(pkg, paragraphs);
  if (!match.paragraphs.length) throw new ReadalongError("None of this package's words were found in this book.");

  // One file per chapter is the most a package needs; a long list only opens uploads.
  if (pkg.manifest.audio.length > MAX_AUDIO_FILES) throw new ReadalongError(`A package may have at most ${MAX_AUDIO_FILES} audio files.`);
  await sweepAbandoned(db, storage, ownerId);
  const id = randomUUID();
  const audio: ReadalongAudio[] = [];
  for (const [i, a] of pkg.manifest.audio.entries()) {
    const ext = (/\.[a-z0-9]+$/i.exec(a.file)?.[0] ?? "").toLowerCase();
    const mime = MIME[ext];
    if (!mime) throw new ReadalongError(`Unsupported audio file ${a.file}: use .m4b, .m4a, .mp3, .wav, .ogg or .flac.`);
    const key = `audio/${ownerId}/${bookId}/readalong-${id}-${i + 1}${ext}`;
    let uploadId: string | null = null;
    if (inZip[a.file]) await storage.put(key, inZip[a.file], mime);
    else uploadId = await storage.startUpload(key, mime);
    audio.push({ file: a.file, key, sha256: a.sha256, seconds: a.seconds, mime, uploadId });
  }
  const pending: ReadalongPending[] = match.paragraphs.map((p) => ({ sectionId: p.sectionId, audio: p.audio, startMs: p.startMs, endMs: p.endMs, words: p.words }));
  await db.insert(readalongImports).values({
    id,
    ownerId,
    bookId,
    status: "uploading",
    title: pkg.manifest.title ?? null,
    voice: pkg.manifest.voice ?? null,
    madeWith: pkg.manifest.made_with ?? null,
    manifest: pkg.manifest,
    report: { chapters: match.chapters, paragraphs: match.paragraphs.length },
    audio,
    pending,
  });
  if (audio.every((a) => !a.uploadId)) return finishImport(db, storage, ownerId, bookId, id, {});
  return summary(await ownedImport(db, ownerId, bookId, id));
}

export async function putAudioPart(db: Db, storage: Storage, ownerId: string, bookId: string, importId: string, file: string, part: number, data: Uint8Array) {
  const row = await ownedImport(db, ownerId, bookId, importId);
  if (row.status !== "uploading") throw new ReadalongError("This import is already finished.");
  const a = row.audio.find((x) => x.file === file && x.uploadId);
  if (!a) throw new ReadalongError(`No audio file ${file} is waiting in this import.`);
  if (!Number.isInteger(part) || part < 1 || part > 10000) throw new ReadalongError("Part numbers run from 1 to 10000.");
  if (data.byteLength === 0 || data.byteLength > MAX_PART_BYTES) throw new ReadalongError(`A part must be 1 byte to ${MAX_PART_BYTES / 1024 / 1024} MB.`);
  return { part, tag: await storage.putPart(a.key, a.uploadId!, part, data) };
}

export async function finishImport(
  db: Db,
  storage: Storage,
  ownerId: string,
  bookId: string,
  importId: string,
  parts: Record<string, { part: number; tag: string }[]>,
): Promise<ImportSummary> {
  const row = await ownedImport(db, ownerId, bookId, importId);
  if (row.status === "ready") return summary(row);
  // Only one finish at a time: it is slow (every audio file is re-read to
  // check it), and a second one (a browser retrying after a lost answer)
  // must not join the same parts again. `finished_at` marks "being finished"
  // until the status becomes ready; a claim older than 15 minutes is
  // abandoned and may be taken over.
  const stale = new Date(Date.now() - 15 * 60 * 1000);
  const claimed = await db
    .update(readalongImports)
    .set({ finishedAt: new Date() })
    .where(
      and(
        eq(readalongImports.id, importId),
        eq(readalongImports.status, "uploading"),
        or(isNull(readalongImports.finishedAt), lt(readalongImports.finishedAt, stale)),
      ),
    )
    .returning({ id: readalongImports.id });
  if (!claimed.length) throw new ReadalongError("This upload is already being finished. Wait a moment, then reload the page.");
  try {
    return await finishClaimed(db, storage, ownerId, bookId, row, parts);
  } catch (e) {
    await db.update(readalongImports).set({ finishedAt: null }).where(and(eq(readalongImports.id, importId), eq(readalongImports.status, "uploading")));
    throw e;
  }
}

async function finishClaimed(
  db: Db,
  storage: Storage,
  ownerId: string,
  bookId: string,
  row: Row,
  parts: Record<string, { part: number; tag: string }[]>,
): Promise<ImportSummary> {
  const importId = row.id;
  // Join each file sent in parts, then check every file against the package.
  for (const a of row.audio.filter((x) => x.uploadId)) {
    const p = parts[a.file];
    if (!p?.length) throw new ReadalongError(`The parts of ${a.file} were not listed.`);
    try {
      await storage.finishUpload(a.key, a.uploadId!, [...p].sort((x, y) => x.part - y.part));
    } catch (e) {
      const why = String((e as Error)?.name ?? "") + String((e as Error)?.message ?? "");
      if (/EntityTooSmall|too small/i.test(why)) {
        throw new ReadalongError(`${a.file} could not be put together: a part before the last is smaller than 5 MB (the storage's minimum).`);
      }
      throw new ReadalongError(`${a.file} could not be put together: a part is missing. Choose the folder again to start over.`);
    }
  }
  for (const a of row.audio) {
    if ((await storedSha256(storage, a.key)) !== a.sha256) {
      // Nothing is kept: half-restarting one file left the others' finished
      // uploads unusable. The reader makes the package again and starts over.
      await deleteImport(db, storage, ownerId, bookId, importId);
      throw new ReadalongError(
        `${a.file} did not arrive intact (its fingerprint differs from the package's). Nothing was kept: choose the folder again; if this happens again, make the package again.`,
      );
    }
  }

  const keyOf = new Map(row.audio.map((a) => [a.file, a]));
  const older = await db
    .select({ id: readalongImports.id, audio: readalongImports.audio })
    .from(readalongImports)
    .where(and(eq(readalongImports.ownerId, ownerId), eq(readalongImports.bookId, bookId), ne(readalongImports.id, importId)));
  await db.transaction(async (tx) => {
    // A finished import replaces the book's earlier ones (their tracks go with them).
    for (const o of older) await tx.delete(readalongImports).where(eq(readalongImports.id, o.id));
    const now = new Date();
    for (const p of row.pending ?? []) {
      const a = keyOf.get(p.audio)!;
      await tx.insert(audioTracks).values({
        ownerId,
        bookId,
        sectionId: p.sectionId,
        source: "upload",
        provider: "upload",
        model: row.madeWith,
        voice: `upload:${importId}`,
        cacheKey: `readalong:${importId}:${p.sectionId}`,
        inputHash: sha256(`${importId}|${p.sectionId}`),
        characters: 0,
        costUsd: 0,
        audioKey: a.key,
        mime: a.mime,
        durationMs: p.endMs - p.startMs,
        words: p.words,
        audioStartMs: p.startMs,
        audioEndMs: p.endMs,
        importId,
        createdAt: now,
      });
    }
    await tx
      .update(readalongImports)
      .set({ status: "ready", pending: null, finishedAt: now, audio: row.audio.map((a) => ({ ...a, uploadId: null })) })
      .where(eq(readalongImports.id, importId));
  });
  for (const o of older) {
    for (const a of o.audio) {
      // An unfinished upload's parts sit in the bucket until cancelled.
      if (a.uploadId) await storage.abortUpload(a.key, a.uploadId).catch(() => {});
      await storage.delete(a.key).catch(() => {});
    }
  }
  return summary(await ownedImport(db, ownerId, bookId, importId));
}

/** Unfinished uploads older than this are cancelled (their parts would otherwise stay in the bucket). */
export const ABANDONED_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

/** Cancels this reader's uploads that were started more than two days ago and never finished, on any book. */
async function sweepAbandoned(db: Db, storage: Storage, ownerId: string) {
  const old = await db
    .select({ id: readalongImports.id, bookId: readalongImports.bookId })
    .from(readalongImports)
    .where(
      and(
        eq(readalongImports.ownerId, ownerId),
        eq(readalongImports.status, "uploading"),
        lt(readalongImports.createdAt, new Date(Date.now() - ABANDONED_AFTER_MS)),
        // not one that is being finished right now (claimed in the last 15 minutes)
        or(isNull(readalongImports.finishedAt), lt(readalongImports.finishedAt, new Date(Date.now() - 15 * 60 * 1000))),
      ),
    );
  for (const o of old) await deleteImport(db, storage, ownerId, o.bookId, o.id).catch(() => {});
}

/** Audio file number `n` (from 0) of a finished import, for its owner only: what the player streams (M13 (d)). */
export async function importAudio(db: Db, ownerId: string, bookId: string, importId: string, n: number): Promise<ReadalongAudio | null> {
  const [row] = await db
    .select({ audio: readalongImports.audio })
    .from(readalongImports)
    .where(
      and(
        eq(readalongImports.id, importId),
        eq(readalongImports.ownerId, ownerId),
        eq(readalongImports.bookId, bookId),
        eq(readalongImports.status, "ready"),
      ),
    );
  return (Number.isInteger(n) && n >= 0 && row?.audio[n]) || null;
}

export async function listImports(db: Db, ownerId: string, bookId: string) {
  await ownedBook(db, ownerId, bookId);
  const rows = await db
    .select()
    .from(readalongImports)
    .where(and(eq(readalongImports.ownerId, ownerId), eq(readalongImports.bookId, bookId)))
    .orderBy(desc(readalongImports.createdAt));
  return rows.map(summary);
}

/** Removes an import, its tracks and its audio files. */
export async function deleteImport(db: Db, storage: Storage, ownerId: string, bookId: string, importId: string) {
  const row = await ownedImport(db, ownerId, bookId, importId);
  await db.delete(readalongImports).where(eq(readalongImports.id, importId));
  for (const a of row.audio) {
    if (a.uploadId) await storage.abortUpload(a.key, a.uploadId).catch(() => {});
    await storage.delete(a.key).catch(() => {});
  }
}
