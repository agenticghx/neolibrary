import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as CFI from "foliate-js/epubcfi.js";
import type { Db } from "@/lib/db/client";
import { annotations, books, sections } from "@/lib/db/schema";
import { isCfi } from "./reading";

/**
 * Highlights, bookmarks and notes (M5).
 * - Ground rule 4: a passage annotation stores the section id, the CFI and the
 *   quoted text with a few words either side, so it can be found again even if
 *   the other two break.
 * - Ground rule 9: nothing is overwritten. An edit adds a new version; a delete
 *   adds a version marked deleted. `history()` shows every version.
 */
export const COLORS = ["sage", "amber", "rose", "sky"] as const;
export type Color = (typeof COLORS)[number];
export type Kind = "highlight" | "bookmark" | "note";

export type Annotation = {
  id: string; // the annotation's stable id (annotation_id)
  version: number;
  kind: Kind;
  targetType: "passage" | "book" | "pillar" | "path";
  bookId: string | null;
  targetId: string | null;
  sectionId: string | null;
  cfi: string | null;
  quote: { exact: string; prefix: string; suffix: string };
  color: Color | null;
  body: string;
  createdAt: string; // first version
  updatedAt: string; // latest version
};

export class AnnotationError extends Error {}

const MAX_BODY = 10_000;
const MAX_QUOTE = 2_000;
const CONTEXT = 64;

type Row = typeof annotations.$inferSelect;

function toAnnotation(latest: Row, first: Row): Annotation {
  return {
    id: latest.annotationId,
    version: latest.version,
    kind: latest.kind,
    targetType: latest.targetType,
    bookId: latest.bookId,
    targetId: latest.targetId,
    sectionId: latest.sectionId,
    cfi: latest.cfi,
    quote: { exact: latest.quoteExact, prefix: latest.quotePrefix, suffix: latest.quoteSuffix },
    color: (latest.color as Color | null) ?? null,
    body: latest.body,
    createdAt: first.createdAt.toISOString(),
    updatedAt: latest.createdAt.toISOString(),
  };
}

/** The paragraph (or heading) a CFI falls in: the last section that starts at or before it, in the same chapter. */
export async function sectionForCfi(db: Db, bookId: string, cfi: string): Promise<string | null> {
  const start = CFI.collapse(cfi);
  const chapter = /^epubcfi\((\/\d+\/\d+)/.exec(start)?.[1];
  const rows = await db
    .select({ id: sections.id, cfi: sections.cfi, kind: sections.kind })
    .from(sections)
    .where(eq(sections.bookId, bookId))
    .orderBy(asc(sections.position));
  let best: string | null = null;
  for (const s of rows) {
    if (s.kind === "chapter" || !chapter || !s.cfi.startsWith(`epubcfi(${chapter}`)) continue;
    // Compare the section's start with the annotation's start.
    const sStart = s.cfi.includes("!") && !s.cfi.includes(",") ? s.cfi.replace(/\)$/, "/1:0)") : s.cfi;
    if (CFI.compare(sStart, start) <= 0) best = s.id;
  }
  return best;
}

const trimQuote = (q: { exact?: unknown; prefix?: unknown; suffix?: unknown } | undefined) => ({
  exact: String(q?.exact ?? "").slice(0, MAX_QUOTE),
  prefix: String(q?.prefix ?? "").slice(-CONTEXT),
  suffix: String(q?.suffix ?? "").slice(0, CONTEXT),
});

async function ownsBook(db: Db, ownerId: string, bookId: unknown) {
  if (typeof bookId !== "string" || !/^[0-9a-f-]{36}$/i.test(bookId)) return false;
  const [b] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  return Boolean(b);
}

export async function createAnnotation(
  db: Db,
  ownerId: string,
  input: {
    kind?: unknown;
    bookId?: unknown;
    cfi?: unknown;
    quote?: { exact?: unknown; prefix?: unknown; suffix?: unknown };
    color?: unknown;
    body?: unknown;
  },
  now = new Date(),
): Promise<Annotation> {
  const kind = input.kind as Kind;
  if (!["highlight", "bookmark", "note"].includes(kind)) throw new AnnotationError("Unknown kind of annotation.");
  if (!(await ownsBook(db, ownerId, input.bookId))) throw new AnnotationError("Book not found.");
  const bookId = input.bookId as string;
  const body = String(input.body ?? "").slice(0, MAX_BODY);
  const quote = trimQuote(input.quote);
  const passage = input.cfi !== undefined && input.cfi !== null;
  if (passage && !isCfi(input.cfi)) throw new AnnotationError("That is not a place in the book.");
  if (kind === "highlight" && (!passage || !quote.exact.trim())) throw new AnnotationError("Select some text to highlight.");
  if (kind === "bookmark" && !passage) throw new AnnotationError("A bookmark needs a place in the book.");
  if (kind === "note" && !body.trim()) throw new AnnotationError("Write something in the note.");
  const color = kind === "highlight" ? ((COLORS as readonly string[]).includes(String(input.color)) ? (input.color as Color) : "sage") : null;
  const cfi = passage ? (input.cfi as string) : null;
  const sectionId = cfi ? await sectionForCfi(db, bookId, cfi) : null;
  const annotationId = crypto.randomUUID();
  const [row] = await db
    .insert(annotations)
    .values({
      id: annotationId,
      annotationId,
      version: 1,
      ownerId,
      kind,
      targetType: passage ? "passage" : "book",
      bookId,
      sectionId,
      cfi,
      quoteExact: quote.exact,
      quotePrefix: quote.prefix,
      quoteSuffix: quote.suffix,
      color,
      body,
      createdAt: now,
    })
    .returning();
  return toAnnotation(row, row);
}

async function versions(db: Db, ownerId: string, annotationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(annotationId)) return [];
  return db
    .select()
    .from(annotations)
    .where(and(eq(annotations.annotationId, annotationId), eq(annotations.ownerId, ownerId)))
    .orderBy(desc(annotations.version));
}

async function addVersion(db: Db, ownerId: string, annotationId: string, change: Partial<Row>, now: Date) {
  const all = await versions(db, ownerId, annotationId);
  const latest = all[0];
  if (!latest || latest.deleted) throw new AnnotationError("Annotation not found.");
  const { id: _id, version, createdAt: _c, ...rest } = latest;
  void _id;
  void _c;
  const [row] = await db
    .insert(annotations)
    .values({ ...rest, ...change, version: version + 1, createdAt: now })
    .returning();
  return toAnnotation(row, all[all.length - 1]);
}

/** Changes colour and/or note text. Adds a new version; the old one stays. */
export async function updateAnnotation(
  db: Db,
  ownerId: string,
  annotationId: string,
  change: { color?: unknown; body?: unknown },
  now = new Date(),
) {
  const patch: Partial<Row> = {};
  if (change.body !== undefined) patch.body = String(change.body).slice(0, MAX_BODY);
  if (change.color !== undefined) {
    if (!(COLORS as readonly string[]).includes(String(change.color))) throw new AnnotationError("Unknown colour.");
    patch.color = change.color as Color;
  }
  return addVersion(db, ownerId, annotationId, patch, now);
}

/** Hides an annotation (soft delete): a new version marked deleted. */
export async function deleteAnnotation(db: Db, ownerId: string, annotationId: string, now = new Date()) {
  await addVersion(db, ownerId, annotationId, { deleted: true }, now);
}

export async function history(db: Db, ownerId: string, annotationId: string) {
  return (await versions(db, ownerId, annotationId)).reverse();
}

/** Current annotations (latest version, not deleted) for a book, in reading order. */
export async function listAnnotations(db: Db, ownerId: string, bookId?: string): Promise<Annotation[]> {
  const rows = await db
    .select()
    .from(annotations)
    .where(bookId ? and(eq(annotations.ownerId, ownerId), eq(annotations.bookId, bookId)) : eq(annotations.ownerId, ownerId))
    .orderBy(asc(annotations.annotationId), asc(annotations.version));
  const byId = new Map<string, Row[]>();
  for (const r of rows) byId.set(r.annotationId, [...(byId.get(r.annotationId) ?? []), r]);
  const current = [...byId.values()]
    .map((list) => ({ latest: list[list.length - 1], first: list[0] }))
    .filter(({ latest }) => !latest.deleted)
    .map(({ latest, first }) => toAnnotation(latest, first));
  return current.sort(readingOrder);
}

/** Book-level notes first, then passages in reading order, then by time. */
export function readingOrder(a: Annotation, b: Annotation): number {
  if (!a.cfi || !b.cfi) return (a.cfi ? 1 : 0) - (b.cfi ? 1 : 0) || a.createdAt.localeCompare(b.createdAt);
  return CFI.compare(CFI.collapse(a.cfi), CFI.collapse(b.cfi)) || a.createdAt.localeCompare(b.createdAt);
}

/** All versions of every annotation of a user (for export). */
export async function allVersions(db: Db, ownerId: string, bookIds?: string[]) {
  return db
    .select()
    .from(annotations)
    .where(bookIds ? and(eq(annotations.ownerId, ownerId), inArray(annotations.bookId, bookIds)) : eq(annotations.ownerId, ownerId))
    .orderBy(asc(annotations.createdAt), asc(annotations.annotationId), asc(annotations.version));
}
