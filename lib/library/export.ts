import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { annotations, books, collectionBooks, collections, generations, paths, pillars, questionMarks, slots, users } from "@/lib/db/schema";

/**
 * Ground rule 7 (no lock-in): everything in a user's library (books, paths,
 * collections, every version of every annotation, and every machine-written
 * text with its provenance) can be exported as one
 * JSON file and imported back. Book files themselves stay in storage; the
 * export records their keys and names.
 */
export const EXPORT_FORMAT = "neolibrary-library";
export const EXPORT_VERSION = 1;

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
    kind: "highlight" | "bookmark" | "note";
    targetType: "passage" | "book" | "pillar" | "path";
    bookId: string | null;
    targetId: string | null;
    sectionId: string | null;
    cfi: string | null;
    quote: { exact: string; prefix: string; suffix: string };
    color: string | null;
    body: string;
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
};

export async function exportLibrary(db: Db, ownerId: string, now = new Date()): Promise<LibraryExport> {
  const bookRows = await db.select().from(books).where(eq(books.ownerId, ownerId)).orderBy(asc(books.createdAt), asc(books.id));
  const pathRows = await db.select().from(paths).where(eq(paths.ownerId, ownerId)).orderBy(asc(paths.createdAt), asc(paths.id));
  const pillarRows = pathRows.length
    ? await db.select().from(pillars).where(inArray(pillars.pathId, pathRows.map((p) => p.id))).orderBy(asc(pillars.position))
    : [];
  const slotRows = pillarRows.length
    ? await db.select().from(slots).where(inArray(slots.pillarId, pillarRows.map((p) => p.id))).orderBy(asc(slots.position))
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
  };
}

export class ExportFormatError extends Error {}

/** Removes a user's whole library (books, paths, collections). Their account stays. */
export async function wipeLibrary(db: Db, ownerId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(annotations).where(eq(annotations.ownerId, ownerId));
    await tx.delete(questionMarks).where(eq(questionMarks.ownerId, ownerId));
    await tx.delete(generations).where(eq(generations.ownerId, ownerId));
    await tx.delete(collections).where(eq(collections.ownerId, ownerId));
    await tx.delete(paths).where(eq(paths.ownerId, ownerId));
    await tx.delete(books).where(eq(books.ownerId, ownerId));
  });
}

/**
 * Restores an export into a user's library, keeping its ids so links between
 * books, slots and collections survive. Refuses rows that already exist.
 */
export async function importLibrary(db: Db, ownerId: string, data: unknown) {
  const x = data as LibraryExport;
  if (!x || x.format !== EXPORT_FORMAT || typeof x.version !== "number") {
    throw new ExportFormatError("This is not a Neolibrary library export.");
  }
  if (x.version > EXPORT_VERSION) throw new ExportFormatError("This export is from a newer version of Neolibrary.");
  const date = (s: string | null) => (s ? new Date(s) : null);
  await db.transaction(async (tx) => {
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
        deleted: a.deleted,
        createdAt: new Date(a.createdAt),
      });
    }
    for (const g of x.generations ?? []) {
      await tx.insert(generations).values({ ...g, ownerId, createdAt: new Date(g.createdAt) });
    }
    for (const m of x.questionMarks ?? []) {
      await tx.insert(questionMarks).values({ ...m, ownerId, createdAt: new Date(m.createdAt) });
    }
  });
}
