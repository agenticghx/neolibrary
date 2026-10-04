import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
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
/** The zip without its audio: scripts and timings, a few MB even for a long book. */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;

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
  finishedAt: r.finishedAt?.toISOString() ?? null,
  report: r.report,
  waitingFor: r.status === "ready" ? [] : r.audio.filter((a) => a.uploadId).map((a) => a.file),
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
  if (zip.byteLength > MAX_ZIP_BYTES) throw new ReadalongError("The package is too large to send in one piece; leave the audio out of the zip and send it in parts.");
  let files: Record<string, Uint8Array>;
  let pkg;
  try {
    files = readPackageZip(zip);
    pkg = parsePackage(files);
  } catch (e) {
    if (e instanceof PackageError) throw new ReadalongError(`This is not a read-along package: ${e.message}.`);
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
  // Join each file sent in parts, then check every file against the package.
  for (const a of row.audio.filter((x) => x.uploadId)) {
    const p = parts[a.file];
    if (!p?.length) throw new ReadalongError(`The parts of ${a.file} were not listed.`);
    try {
      await storage.finishUpload(a.key, a.uploadId!, [...p].sort((x, y) => x.part - y.part));
    } catch {
      throw new ReadalongError(`${a.file} could not be put together: a part is missing. Send it again.`);
    }
  }
  for (const a of row.audio) {
    if ((await storedSha256(storage, a.key)) !== a.sha256) {
      await storage.delete(a.key);
      const restarted = await storage.startUpload(a.key, a.mime);
      await db
        .update(readalongImports)
        .set({ audio: row.audio.map((x) => (x.file === a.file ? { ...x, uploadId: restarted } : x)) })
        .where(eq(readalongImports.id, importId));
      throw new ReadalongError(`${a.file} is not the audio this package was made with (its fingerprint differs). Send that file again.`);
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
  for (const o of older) for (const a of o.audio) await storage.delete(a.key).catch(() => {});
  return summary(await ownedImport(db, ownerId, bookId, importId));
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
