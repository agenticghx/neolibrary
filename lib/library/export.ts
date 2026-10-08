import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { annotations, audioTracks, books, readalongImports, collectionBooks, collections, generations, paths, pillars, questionMarks, readingSessions, slots, users, type ChapterReading } from "@/lib/db/schema";
import { assertSafeKey } from "@/lib/storage";
import { cleanPicture } from "./pinned";

/**
 * Ground rule 7 (no lock-in): everything in a user's library (books, paths,
 * collections, every version of every annotation, and every machine-written
 * text with its provenance) can be exported as one
 * JSON file and imported back. Book files themselves stay in storage; the
 * export records their keys and names.
 */
export const EXPORT_FORMAT = "neolibrary-library";
export const EXPORT_VERSION = 1;
/** A library file is metadata (books, notes, paths), not the book files. 32 MB is far past a real one. */
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export type LibraryExport = {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  books: {
    id: string;
    title: string;
    author: string;
    note: string;
    unverified: boolean;
    file: { key: string; name: string | null; type: "epub" | "pdf" | null; size: number | null } | null;
    coverKey: string | null;
    language: string | null;
    publisher: string | null;
    description: string | null;
    toc: unknown[];
    pageCount: number | null;
    progress: number;
    /** Reading position (EPUB CFI); added in M4, absent in older exports. */
    position?: string | null;
    /** This book's style for AI explanations (null = the reader's setting); added in M6. */
    aiStyle?: "plain" | "ste-light" | "ste-standard" | "ste-strict" | null;
    lastOpenedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  paths: {
    id: string;
    slug: string;
    title: string;
    description: string;
    sourceUrl: string | null;
    createdAt: string;
    pillars: {
      id: string;
      slug: string;
      title: string;
      question: string;
      group: string;
      slots: { id: string; kind: "N" | "E" | "extra" | "master"; bookId: string; note: string }[];
    }[];
  }[];
  collections: { id: string; name: string; createdAt: string; bookIds: string[] }[];
  /** Every version of every highlight, bookmark and note (added in M5; nothing is ever overwritten). */
  annotations?: {
    id: string;
    annotationId: string;
    version: number;
    kind: "highlight" | "bookmark" | "note" | "voice" | "sticker" | "drawing" | "image";
    targetType: "passage" | "book" | "pillar" | "path";
    bookId: string | null;
    targetId: string | null;
    sectionId: string | null;
    cfi: string | null;
    quote: { exact: string; prefix: string; suffix: string };
    color: string | null;
    body: string;
    /** Voice notes (added in M8): the recording's storage key, type, length and transcript. */
    audio?: { key: string; mime: string | null; durationMs: number | null } | null;
    transcript?: string;
    /** Stickers (added in M8). */
    sticker?: string | null;
    /** Handwritten notes (added in M8): strokes on the 600 × 300 pad. */
    drawing?: { width: number; height: number; strokes: number[][] } | null;
    /** Pinned pictures (added in M9). */
    picture?: Record<string, unknown> | null;
    /** Added by an AI agent (M11): the API token's name. */
    agent?: string | null;
    deleted: boolean;
    createdAt: string;
  }[];
  /** The reader's settings (added in M6). */
  settings?: { aiStyle: "plain" | "ste-light" | "ste-standard" | "ste-strict" };
  /** Machine-written text (rewrites, …) with its provenance (added in M6). */
  generations?: {
    id: string;
    bookId: string | null;
    sectionId: string | null;
    kind: string;
    options: Record<string, string>;
    cacheKey: string;
    provider: string;
    model: string;
    promptName: string;
    promptHash: string;
    inputHash: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    output: string;
    createdAt: string;
  }[];
  /** Every right/wrong mark on question-bank questions (added in M6; append-only). */
  questionMarks?: { id: string; bookId: string; chapterId: string; generationId: string; questionIndex: number; correct: boolean; createdAt: string }[];
  /** Read-aloud audio tracks with word timings and provenance (added in M7). The audio files stay in storage, like book files. */
  audioTracks?: {
    id: string;
    bookId: string;
    sectionId: string;
    source: "tts" | "upload";
    provider: string | null;
    model: string | null;
    voice: string;
    cacheKey: string;
    inputHash: string;
    characters: number;
    costUsd: number;
    audioKey: string;
    mime: string;
    durationMs: number;
    words: [number, number, number, number][];
    createdAt: string;
    /** M13: an uploaded track's stretch of its (longer) audio file, and its import. */
    audioStartMs?: number | null;
    audioEndMs?: number | null;
    importId?: string | null;
  }[];
  /** Uploaded read-along audiobooks (added in M13). Their audio files stay in storage, like book files. */
  readalongImports?: {
    id: string;
    bookId: string;
    status: "uploading" | "ready";
    title: string | null;
    voice: string | null;
    madeWith: string | null;
    manifest: unknown;
    report: (typeof readalongImports.$inferSelect)["report"];
    audio: (typeof readalongImports.$inferSelect)["audio"];
    pending: (typeof readalongImports.$inferSelect)["pending"];
    createdAt: string;
    finishedAt: string | null;
  }[];
  /** Reading sittings for the statistics (added in M10). */
  readingSessions?: {
    id: string;
    bookId: string;
    startedAt: string;
    endedAt: string;
    activeSeconds: number;
    words: number;
    pages: number;
    chapters?: ChapterReading[];
  }[];
};

export async function exportLibrary(db: Db, ownerId: string, now = new Date()): Promise<LibraryExport> {
  const bookRows = await db.select().from(books).where(eq(books.ownerId, ownerId)).orderBy(asc(books.createdAt), asc(books.id));
  const pathRows = await db.select().from(paths).where(eq(paths.ownerId, ownerId)).orderBy(asc(paths.createdAt), asc(paths.id));
  const pillarRows = pathRows.length
    ? await db.select().from(pillars).where(inArray(pillars.pathId, pathRows.map((p) => p.id))).orderBy(asc(pillars.position), asc(pillars.id))
    : [];
  const slotRows = pillarRows.length
    ? await db.select().from(slots).where(inArray(slots.pillarId, pillarRows.map((p) => p.id))).orderBy(asc(slots.position), asc(slots.id))
    : [];
  const collectionRows = await db
    .select()
    .from(collections)
    .where(eq(collections.ownerId, ownerId))
    .orderBy(asc(collections.createdAt), asc(collections.id));
  const memberRows = collectionRows.length
    ? await db
        .select()
        .from(collectionBooks)
        .where(inArray(collectionBooks.collectionId, collectionRows.map((c) => c.id)))
        .orderBy(asc(collectionBooks.addedAt), asc(collectionBooks.bookId))
    : [];

  const annotationRows = await db
    .select()
    .from(annotations)
    .where(eq(annotations.ownerId, ownerId))
    .orderBy(asc(annotations.createdAt), asc(annotations.annotationId), asc(annotations.version));

  const generationRows = await db
    .select()
    .from(generations)
    .where(eq(generations.ownerId, ownerId))
    .orderBy(asc(generations.createdAt), asc(generations.id));

  const markRows = await db
    .select()
    .from(questionMarks)
    .where(eq(questionMarks.ownerId, ownerId))
    .orderBy(asc(questionMarks.createdAt), asc(questionMarks.id));
  const importRows = await db
    .select()
    .from(readalongImports)
    .where(eq(readalongImports.ownerId, ownerId))
    .orderBy(asc(readalongImports.createdAt), asc(readalongImports.id));
  const trackRows = await db
    .select()
    .from(audioTracks)
    .where(eq(audioTracks.ownerId, ownerId))
    .orderBy(asc(audioTracks.createdAt), asc(audioTracks.id));
  const sessionRows = await db
    .select()
    .from(readingSessions)
    .where(eq(readingSessions.ownerId, ownerId))
    .orderBy(asc(readingSessions.startedAt), asc(readingSessions.id));
  const [settings] = await db.select({ aiStyle: users.aiStyle }).from(users).where(eq(users.id, ownerId));

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    settings: { aiStyle: settings?.aiStyle ?? "plain" },
    books: bookRows
      .filter((b) => !b.deletedAt)
      .map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        note: b.note,
        unverified: b.unverified,
        file: b.fileKey ? { key: b.fileKey, name: b.fileName, type: b.fileType, size: b.fileSize } : null,
        coverKey: b.coverKey,
        language: b.language,
        publisher: b.publisher,
        description: b.description,
        toc: b.toc,
        pageCount: b.pageCount,
        progress: b.progress,
        position: b.position,
        aiStyle: b.aiStyle,
        lastOpenedAt: iso(b.lastOpenedAt),
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      })),
    paths: pathRows.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      sourceUrl: p.sourceUrl,
      createdAt: p.createdAt.toISOString(),
      pillars: pillarRows
        .filter((x) => x.pathId === p.id)
        .map((x) => ({
          id: x.id,
          slug: x.slug,
          title: x.title,
          question: x.question,
          group: x.group,
          slots: slotRows
            .filter((s) => s.pillarId === x.id)
            .map((s) => ({ id: s.id, kind: s.kind, bookId: s.bookId, note: s.note })),
        })),
    })),
    collections: collectionRows.map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt.toISOString(),
      bookIds: memberRows.filter((m) => m.collectionId === c.id).map((m) => m.bookId),
    })),
    annotations: annotationRows.map((a) => ({
      id: a.id,
      annotationId: a.annotationId,
      version: a.version,
      kind: a.kind,
      targetType: a.targetType,
      bookId: a.bookId,
      targetId: a.targetId,
      sectionId: a.sectionId,
      cfi: a.cfi,
      quote: { exact: a.quoteExact, prefix: a.quotePrefix, suffix: a.quoteSuffix },
      color: a.color,
      body: a.body,
      audio: a.audioKey ? { key: a.audioKey, mime: a.audioMime, durationMs: a.durationMs } : null,
      transcript: a.transcript,
      sticker: a.sticker,
      drawing: a.strokes,
      picture: a.picture,
      agent: a.agent,
      deleted: a.deleted,
      createdAt: a.createdAt.toISOString(),
    })),
    generations: generationRows.map((g) => ({
      id: g.id,
      bookId: g.bookId,
      sectionId: g.sectionId,
      kind: g.kind,
      options: g.options,
      cacheKey: g.cacheKey,
      provider: g.provider,
      model: g.model,
      promptName: g.promptName,
      promptHash: g.promptHash,
      inputHash: g.inputHash,
      inputTokens: g.inputTokens,
      outputTokens: g.outputTokens,
      costUsd: g.costUsd,
      output: g.output,
      createdAt: g.createdAt.toISOString(),
    })),
    questionMarks: markRows.map((m) => ({
      id: m.id,
      bookId: m.bookId,
      chapterId: m.chapterId,
      generationId: m.generationId,
      questionIndex: m.questionIndex,
      correct: m.correct,
      createdAt: m.createdAt.toISOString(),
    })),
    audioTracks: trackRows.map((t) => ({
      id: t.id,
      bookId: t.bookId,
      sectionId: t.sectionId,
      source: t.source,
      provider: t.provider,
      model: t.model,
      voice: t.voice,
      cacheKey: t.cacheKey,
      inputHash: t.inputHash,
      characters: t.characters,
      costUsd: t.costUsd,
      audioKey: t.audioKey,
      mime: t.mime,
      durationMs: t.durationMs,
      words: t.words,
      createdAt: t.createdAt.toISOString(),
      audioStartMs: t.audioStartMs,
      audioEndMs: t.audioEndMs,
      importId: t.importId,
    })),
    readalongImports: importRows.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      status: r.status,
      title: r.title,
      voice: r.voice,
      madeWith: r.madeWith,
      manifest: r.manifest,
      report: r.report,
      audio: r.audio,
      pending: r.pending,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
    readingSessions: sessionRows.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt.toISOString(),
      activeSeconds: r.activeSeconds,
      words: r.words,
      pages: r.pages,
      chapters: r.chapters,
    })),
  };
}

export class ExportFormatError extends Error {}

/** Removes a user's whole library (books, paths, collections). Their account stays. */
export async function wipeLibrary(db: Db, ownerId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(annotations).where(eq(annotations.ownerId, ownerId));
    await tx.delete(questionMarks).where(eq(questionMarks.ownerId, ownerId));
    await tx.delete(audioTracks).where(eq(audioTracks.ownerId, ownerId));
    await tx.delete(readalongImports).where(eq(readalongImports.ownerId, ownerId));
    await tx.delete(readingSessions).where(eq(readingSessions.ownerId, ownerId));
    await tx.delete(generations).where(eq(generations.ownerId, ownerId));
    await tx.delete(collections).where(eq(collections.ownerId, ownerId));
    await tx.delete(paths).where(eq(paths.ownerId, ownerId));
    await tx.delete(books).where(eq(books.ownerId, ownerId));
  });
}

/** A stored file's key, if it is a safe key in this reader's own folder (keys are `<folder>/<ownerId>/…`, see import.ts, audio.ts, voice-notes.ts). */
function ownKey(key: unknown, folder: "books" | "covers" | "audio", ownerId: string) {
  if (typeof key !== "string" || !key.startsWith(`${folder}/${ownerId}/`)) return false;
  try {
    assertSafeKey(key);
    return true;
  } catch {
    return false;
  }
}

const isCost = (c: unknown) => typeof c === "number" && Number.isFinite(c) && c >= 0;

/**
 * A library file can be written by hand as easily as by an export, so before
 * anything is written: every stored file it names must be in this reader's
 * own folders, every row it links to must be one the file itself brings, and
 * every cost must be an amount of money. Throws ExportFormatError otherwise.
 */
function checkImport(x: LibraryExport, ownerId: string) {
  const refuse = (why: string): never => {
    throw new ExportFormatError(`${why} Nothing was imported.`);
  };
  const bookIds = new Set(x.books.map((b) => b.id));
  for (const b of x.books) {
    if (b.file && !ownKey(b.file.key, "books", ownerId)) refuse(`The file of "${b.title}" is not stored in your library.`);
    if (b.coverKey != null && !ownKey(b.coverKey, "covers", ownerId)) refuse(`The cover of "${b.title}" is not stored in your library.`);
  }
  const pathIds = new Set(x.paths.map((p) => p.id));
  const pillarIds = new Set(x.paths.flatMap((p) => p.pillars.map((pil) => pil.id)));
  for (const p of x.paths) {
    for (const pil of p.pillars) for (const s of pil.slots) if (!bookIds.has(s.bookId)) refuse(`The Path "${p.title}" lists a book that is not in this file.`);
  }
  for (const c of x.collections) for (const id of c.bookIds) if (!bookIds.has(id)) refuse(`The collection "${c.name}" holds a book that is not in this file.`);
  for (const a of x.annotations ?? []) {
    if (a.bookId != null && !bookIds.has(a.bookId)) refuse("A note is on a book that is not in this file.");
    // Notes on a Path or a section of one point at it by id (no database link checks that).
    const targets = a.targetType === "path" ? pathIds : a.targetType === "pillar" ? pillarIds : bookIds;
    if (a.targetId != null && !targets.has(a.targetId)) refuse("A note is on something that is not in this file.");
    if (a.audio && !ownKey(a.audio.key, "audio", ownerId)) refuse("A voice note's recording is not stored in your library.");
    // The same check as when a picture is pinned: a generated one must be in this reader's folder.
    if (a.picture != null && !cleanPicture(a.picture, ownerId)) refuse("A pinned picture is not one your library can show.");
  }
  const generationIds = new Set<string>();
  for (const g of x.generations ?? []) {
    if (g.bookId != null && !bookIds.has(g.bookId)) refuse("An AI text is about a book that is not in this file.");
    if (!isCost(g.costUsd)) refuse("An AI text's cost is not an amount of money.");
    generationIds.add(g.id);
  }
  for (const m of x.questionMarks ?? []) {
    if (!bookIds.has(m.bookId) || !generationIds.has(m.generationId)) refuse("A question mark is on a book or question bank that is not in this file.");
  }
  const importIds = new Set<string>();
  for (const r of x.readalongImports ?? []) {
    if (!bookIds.has(r.bookId)) refuse("An audiobook is for a book that is not in this file.");
    // A half-sent upload cannot be finished from a file: export again once it is done.
    if (r.status !== "ready" || r.audio.some((f) => f.uploadId != null)) refuse("An audiobook was still uploading when this file was made.");
    if (r.audio.some((f) => !ownKey(f.key, "audio", ownerId))) refuse("An audiobook's audio file is not stored in your library.");
    importIds.add(r.id);
  }
  for (const t of x.audioTracks ?? []) {
    if (!bookIds.has(t.bookId)) refuse("A read-aloud track is for a book that is not in this file.");
    if (t.importId != null && !importIds.has(t.importId)) refuse("A read-aloud track belongs to an audiobook that is not in this file.");
    if (!ownKey(t.audioKey, "audio", ownerId)) refuse("A read-aloud track's audio file is not stored in your library.");
    if (!isCost(t.costUsd)) refuse("A read-aloud track's cost is not an amount of money.");
  }
  for (const r of x.readingSessions ?? []) if (!bookIds.has(r.bookId)) refuse("A reading session is for a book that is not in this file.");
}

/**
 * Restores an export into a user's library, keeping its ids so links between
 * books, slots and collections survive. Refuses rows that already exist, and
 * files that point outside this reader's library (see checkImport).
 */
export async function importLibrary(db: Db, ownerId: string, data: unknown) {
  const x = data as LibraryExport;
  if (!x || x.format !== EXPORT_FORMAT || typeof x.version !== "number") {
    throw new ExportFormatError("This is not a Neolibrary library export.");
  }
  if (x.version > EXPORT_VERSION) throw new ExportFormatError("This export is from a newer version of Neolibrary.");
  checkImport(x, ownerId);
  const date = (s: string | null) => (s ? new Date(s) : null);
  await db.transaction(async (tx) => {
    // A note's versions share an annotationId, which the database does not keep
    // unique; the library is empty, so one already in use is another reader's.
    const noteIds = [...new Set((x.annotations ?? []).map((a) => a.annotationId))];
    if (noteIds.length) {
      const [taken] = await tx.select({ id: annotations.id }).from(annotations).where(inArray(annotations.annotationId, noteIds)).limit(1);
      if (taken) throw new ExportFormatError("Some notes in this file already exist in the library. Nothing was imported.");
    }
    if (x.settings?.aiStyle) await tx.update(users).set({ aiStyle: x.settings.aiStyle }).where(eq(users.id, ownerId));
    for (const b of x.books) {
      await tx.insert(books).values({
        id: b.id,
        ownerId,
        title: b.title,
        author: b.author,
        note: b.note,
        unverified: b.unverified,
        fileKey: b.file?.key ?? null,
        fileName: b.file?.name ?? null,
        fileType: b.file?.type ?? null,
        fileSize: b.file?.size ?? null,
        coverKey: b.coverKey,
        language: b.language,
        publisher: b.publisher,
        description: b.description,
        toc: b.toc as never,
        pageCount: b.pageCount,
        progress: b.progress,
        position: b.position ?? null,
        aiStyle: b.aiStyle ?? null,
        lastOpenedAt: date(b.lastOpenedAt),
        createdAt: new Date(b.createdAt),
        updatedAt: new Date(b.updatedAt),
      });
    }
    for (const p of x.paths) {
      await tx.insert(paths).values({
        id: p.id,
        ownerId,
        slug: p.slug,
        title: p.title,
        description: p.description,
        sourceUrl: p.sourceUrl,
        createdAt: new Date(p.createdAt),
      });
      for (const [i, pil] of p.pillars.entries()) {
        await tx.insert(pillars).values({
          id: pil.id,
          pathId: p.id,
          position: i,
          slug: pil.slug,
          title: pil.title,
          question: pil.question,
          group: pil.group,
        });
        for (const [j, s] of pil.slots.entries()) {
          await tx.insert(slots).values({ id: s.id, pillarId: pil.id, position: j, kind: s.kind, bookId: s.bookId, note: s.note });
        }
      }
    }
    for (const c of x.collections) {
      await tx.insert(collections).values({ id: c.id, ownerId, name: c.name, createdAt: new Date(c.createdAt) });
      for (const [k, bookId] of c.bookIds.entries()) {
        // Keep the original order: later books get later timestamps.
        await tx.insert(collectionBooks).values({ collectionId: c.id, bookId, addedAt: new Date(new Date(c.createdAt).getTime() + k) });
      }
    }
    for (const a of x.annotations ?? []) {
      await tx.insert(annotations).values({
        id: a.id,
        annotationId: a.annotationId,
        version: a.version,
        ownerId,
        kind: a.kind,
        targetType: a.targetType,
        bookId: a.bookId,
        targetId: a.targetId,
        sectionId: a.sectionId,
        cfi: a.cfi,
        quoteExact: a.quote.exact,
        quotePrefix: a.quote.prefix,
        quoteSuffix: a.quote.suffix,
        color: a.color,
        body: a.body,
        audioKey: a.audio?.key ?? null,
        audioMime: a.audio?.mime ?? null,
        durationMs: a.audio?.durationMs ?? null,
        transcript: a.transcript ?? "",
        sticker: a.sticker ?? null,
        strokes: a.drawing ?? null,
        picture: a.picture ?? null,
        agent: a.agent ?? null,
        deleted: a.deleted,
        createdAt: new Date(a.createdAt),
      });
    }
    // Imported AI texts and tracks keep the cost they record, marked `imported`
    // so it is not counted as this month's spending (the caps cover every reader).
    for (const g of x.generations ?? []) {
      await tx.insert(generations).values({ ...g, ownerId, createdAt: new Date(g.createdAt), imported: true });
    }
    for (const m of x.questionMarks ?? []) {
      await tx.insert(questionMarks).values({ ...m, ownerId, createdAt: new Date(m.createdAt) });
    }
    // Imports before tracks: an uploaded track points at its import.
    for (const r of x.readalongImports ?? []) {
      await tx.insert(readalongImports).values({ ...r, ownerId, createdAt: new Date(r.createdAt), finishedAt: r.finishedAt ? new Date(r.finishedAt) : null });
    }
    for (const t of x.audioTracks ?? []) {
      await tx.insert(audioTracks).values({ ...t, ownerId, createdAt: new Date(t.createdAt), imported: true });
    }
    for (const r of x.readingSessions ?? []) {
      await tx
        .insert(readingSessions)
        .values({ ...r, ownerId, startedAt: new Date(r.startedAt), endedAt: new Date(r.endedAt), chapters: r.chapters ?? [] });
    }
  });
}
