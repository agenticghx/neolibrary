import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as CFI from "foliate-js/epubcfi.js";
import type { Db } from "@/lib/db/client";
import { annotations, books, paths, pillars, sections } from "@/lib/db/schema";
import { isCfi } from "./reading";
import { isSticker, type Sticker } from "./stickers";
import { cleanDrawing, type Drawing } from "./drawings";
import { cleanPicture, type PinnedPicture } from "./pinned";

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
export type Kind = "highlight" | "bookmark" | "note" | "voice" | "sticker" | "drawing" | "image";

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
  /** Voice notes (M8): the recording and what was said. */
  voice: { audioKey: string; mime: string; durationMs: number; transcript: string } | null;
  /** Stickers (M8): which one. */
  sticker: Sticker | null;
  /** Handwritten notes (M8): pen strokes on a fixed-size pad. */
  drawing: Drawing | null;
  /** Pinned pictures (M9): from Wikimedia Commons or generated. */
  picture: PinnedPicture | null;
  /** Added by an AI agent through the agent API (M11): the token's name. Null when the reader wrote it. */
  agent: string | null;
  /** In the browser only: made offline, waiting in the outbox to be sent (M12). */
  pending?: boolean;
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
    voice:
      latest.kind === "voice" && latest.audioKey
        ? { audioKey: latest.audioKey, mime: latest.audioMime ?? "audio/webm", durationMs: latest.durationMs ?? 0, transcript: latest.transcript }
        : null,
    sticker: latest.kind === "sticker" && isSticker(latest.sticker) ? latest.sticker : null,
    drawing: latest.kind === "drawing" && latest.strokes ? latest.strokes : null,
    picture: latest.kind === "image" && latest.picture ? (latest.picture as PinnedPicture) : null,
    agent: first.agent ?? null,
    createdAt: first.createdAt.toISOString(),
    updatedAt: latest.createdAt.toISOString(),
  };
}

/** The paragraph (or heading) a CFI falls in: the last section that starts at or before it, in the same chapter. */
// An element's CFI (a whole paragraph, no character offset) means its first
// character: compare both sides in that form, so a paragraph's own CFI
// falls in that paragraph and not in the one before.
const atStart = (c: string) => (c.includes("!") && !c.includes(",") && !/:\d+(\[[^\]]*\])?\)$/.test(c) ? c.replace(/\)$/, "/1:0)") : c);

/** The spine item (chapter, or a PDF's page) a CFI is in: its first step's number. */
const spineStep = (c: string) => Number(/^epubcfi\(\/\d+\/(\d+)/.exec(c)?.[1] ?? -1);

/** At most this many paragraphs for one screen: more means a bad range, and a known upper cost. */
const MAX_ON_SCREEN = 40;

/**
 * The paragraphs on screen (M17): from the one the screen starts in (`from`)
 * to the last one that starts on it (`to`), in reading order. A range CFI
 * (an EPUB's visible page) counts from its start to its end. In a PDF, all of
 * a page's paragraphs share the page's CFI, so a page brings all of them.
 * A screen that starts before its chapter's first paragraph (a title) starts
 * at that paragraph, not in the chapter before.
 */
export async function paragraphsBetween(db: Db, bookId: string, from: string, to: string) {
  const start = atStart(CFI.collapse(from));
  const end = atStart(CFI.collapse(to, true));
  const rows = await db
    .select({ id: sections.id, cfi: sections.cfi, text: sections.text, chapterIndex: sections.chapterIndex })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph")))
    .orderBy(asc(sections.position));
  let first = -1;
  let last = -1;
  rows.forEach((s, i) => {
    const at = atStart(s.cfi);
    // The paragraph the screen starts in, in the same chapter (the first of those sharing its place).
    if (spineStep(s.cfi) === spineStep(start) && CFI.compare(at, start) <= 0 && (first < 0 || rows[first].cfi !== s.cfi)) first = i;
    if (CFI.compare(at, end) <= 0) last = i;
  });
  if (first < 0) first = rows.findIndex((s) => CFI.compare(atStart(s.cfi), start) > 0);
  if (first < 0 || last < first) return [];
  return rows.slice(first, Math.min(last + 1, first + MAX_ON_SCREEN)).filter((s) => s.text.trim());
}

export async function sectionForCfi(db: Db, bookId: string, cfi: string, quote = ""): Promise<string | null> {
  const start = CFI.collapse(cfi);
  const chapter = /^epubcfi\((\/\d+\/\d+)/.exec(start)?.[1];
  const rows = await db
    .select({ id: sections.id, cfi: sections.cfi, kind: sections.kind })
    .from(sections)
    .where(eq(sections.bookId, bookId))
    .orderBy(asc(sections.position));
  const point = atStart(start);
  let best: string | null = null;
  // The sections at the place found: one in an EPUB; in a PDF, all of a page's paragraphs (they share its place).
  let tied: string[] = [];
  let tiedCfi = "";
  for (const s of rows) {
    if (s.kind === "chapter" || !chapter || !s.cfi.startsWith(`epubcfi(${chapter}`)) continue;
    // Compare the section's start with the annotation's start.
    if (CFI.compare(atStart(s.cfi), point) <= 0) {
      if (s.cfi !== tiedCfi) {
        tied = [];
        tiedCfi = s.cfi;
      }
      tied.push(s.id);
      best = s.id;
    }
  }
  // Several at that place: the one whose text holds the quote (compared without spaces: a PDF's text layer may
  // space the same letters differently). Otherwise the last of them, as before.
  const squeeze = (t: string) => t.replace(/\s+/g, "");
  const q = squeeze(quote).slice(0, 40);
  if (tied.length > 1 && q) {
    const texts = await db.select({ id: sections.id, text: sections.text }).from(sections).where(inArray(sections.id, tied));
    const hit = tied.find((id) => squeeze(texts.find((t) => t.id === id)?.text ?? "").includes(q));
    if (hit) return hit;
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
    /** For notes on a pillar or a whole path (instead of a book). */
    targetType?: unknown;
    targetId?: unknown;
    /** Voice notes: the stored recording (see voice-notes.ts) and its transcript. */
    voice?: { audioKey: string; mime: string; durationMs: number; transcript: string };
    /** Stickers: one of STICKERS. */
    sticker?: unknown;
    /** Handwritten notes: { strokes: [[x, y, …], …] } on the 600 × 300 pad. */
    drawing?: unknown;
    /** Pinned pictures: see pinned.ts. */
    picture?: unknown;
  },
  now = new Date(),
  /** Keep a given id (used when importing an export). */
  id?: string,
  /** Set only by the agent API: the name of the API token adding it (provenance, ground rule 5). */
  agent?: string,
): Promise<Annotation> {
  const kind = input.kind as Kind;
  if (!["highlight", "bookmark", "note", "voice", "sticker", "drawing", "image"].includes(kind)) throw new AnnotationError("Unknown kind of annotation.");
  if (input.targetType === "pillar" || input.targetType === "path") {
    return createTargetNote(db, ownerId, input.targetType, input.targetId, String(input.body ?? ""), now, id);
  }
  if (!(await ownsBook(db, ownerId, input.bookId))) throw new AnnotationError("Book not found.");
  const bookId = input.bookId as string;
  const body = String(input.body ?? "").slice(0, MAX_BODY);
  const quote = trimQuote(input.quote);
  const passage = input.cfi !== undefined && input.cfi !== null;
  if (passage && !isCfi(input.cfi)) throw new AnnotationError("That is not a place in the book.");
  if (kind === "highlight" && (!passage || !quote.exact.trim())) throw new AnnotationError("Select some text to highlight.");
  if (kind === "bookmark" && !passage) throw new AnnotationError("A bookmark needs a place in the book.");
  if (kind === "note" && !body.trim()) throw new AnnotationError("Write something in the note.");
  const voice = kind === "voice" ? input.voice : undefined;
  if (kind === "voice" && (!voice || !voice.audioKey.startsWith(`audio/${ownerId}/`))) throw new AnnotationError("A voice note needs a recording.");
  if (kind === "sticker" && (!passage || !isSticker(input.sticker))) throw new AnnotationError("Choose a sticker for a place in the book.");
  const drawing = kind === "drawing" ? cleanDrawing(input.drawing) : null;
  if (kind === "drawing" && (!passage || !drawing)) throw new AnnotationError("Draw something for a place in the book.");
  const picture = kind === "image" ? cleanPicture(input.picture, ownerId) : null;
  if (kind === "image" && (!passage || !picture)) throw new AnnotationError("Choose a picture for a place in the book.");
  const color = kind === "highlight" ? ((COLORS as readonly string[]).includes(String(input.color)) ? (input.color as Color) : "sage") : null;
  const cfi = passage ? (input.cfi as string) : null;
  const sectionId = cfi ? await sectionForCfi(db, bookId, cfi, quote.exact) : null;
  const annotationId = id ?? crypto.randomUUID();
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
      ...(voice
        ? { audioKey: voice.audioKey, audioMime: voice.mime, durationMs: Math.round(voice.durationMs), transcript: voice.transcript.slice(0, MAX_BODY) }
        : {}),
      ...(kind === "sticker" ? { sticker: input.sticker as Sticker } : {}),
      ...(drawing ? { strokes: drawing } : {}),
      ...(picture ? { picture: picture as unknown as Record<string, unknown> } : {}),
      ...(agent ? { agent: agent.slice(0, 100) } : {}),
      createdAt: now,
    })
    .returning();
  return toAnnotation(row, row);
}

/**
 * Creates an annotation with an id the browser chose (M12: notes made offline
 * are sent again when the network returns). Sending the same one twice is
 * harmless: if that id already exists for this reader, the current version is
 * returned and nothing is added. An id that belongs to someone else is refused.
 */
export async function createAnnotationOnce(db: Db, ownerId: string, id: unknown, input: Parameters<typeof createAnnotation>[2], now = new Date()) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new AnnotationError("Bad annotation id.");
  const [existing] = await db.select({ ownerId: annotations.ownerId }).from(annotations).where(eq(annotations.annotationId, id)).limit(1);
  if (existing) {
    if (existing.ownerId !== ownerId) throw new AnnotationError("That annotation id is already taken.");
    const rows = await versions(db, ownerId, id);
    return { annotation: toAnnotation(rows[0], rows.at(-1)!), created: false }; // versions() lists newest first
  }
  return { annotation: await createAnnotation(db, ownerId, input, now, id.toLowerCase()), created: true };
}

/** A note on a pillar or a whole path (ground rule 4: notes can attach to a Path or a Pillar). */
async function createTargetNote(
  db: Db,
  ownerId: string,
  targetType: "pillar" | "path",
  targetId: unknown,
  body: string,
  now: Date,
  id?: string,
): Promise<Annotation> {
  if (typeof targetId !== "string" || !/^[0-9a-f-]{36}$/i.test(targetId)) throw new AnnotationError("Not found.");
  const target =
    targetType === "path"
      ? await db.select({ id: paths.id }).from(paths).where(and(eq(paths.id, targetId), eq(paths.ownerId, ownerId)))
      : await db
          .select({ id: pillars.id })
          .from(pillars)
          .innerJoin(paths, eq(paths.id, pillars.pathId))
          .where(and(eq(pillars.id, targetId), eq(paths.ownerId, ownerId)));
  if (!target.length) throw new AnnotationError("Not found.");
  const text = body.slice(0, MAX_BODY);
  if (!text.trim()) throw new AnnotationError("Write something in the note.");
  const annotationId = id ?? crypto.randomUUID();
  const [row] = await db
    .insert(annotations)
    .values({ id: annotationId, annotationId, version: 1, ownerId, kind: "note", targetType, targetId, body: text, createdAt: now })
    .returning();
  return toAnnotation(row, row);
}

/** Current notes on a path and on each of its pillars, keyed by target id. */
export async function notesForPath(db: Db, ownerId: string, pathId: string) {
  const pillarIds = (await db.select({ id: pillars.id }).from(pillars).where(eq(pillars.pathId, pathId))).map((p) => p.id);
  const targets = [pathId, ...pillarIds];
  const rows = await db
    .select()
    .from(annotations)
    .where(and(eq(annotations.ownerId, ownerId), inArray(annotations.targetId, targets)))
    .orderBy(asc(annotations.annotationId), asc(annotations.version));
  const byId = new Map<string, Row[]>();
  for (const r of rows) byId.set(r.annotationId, [...(byId.get(r.annotationId) ?? []), r]);
  const out = new Map<string, Annotation[]>();
  for (const list of byId.values()) {
    const latest = list[list.length - 1];
    if (latest.deleted || !latest.targetId) continue;
    out.set(latest.targetId, [...(out.get(latest.targetId) ?? []), toAnnotation(latest, list[0])]);
  }
  for (const list of out.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

async function versions(db: Db, ownerId: string, annotationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(annotationId)) return [];
  return db
    .select()
    .from(annotations)
    .where(and(eq(annotations.annotationId, annotationId), eq(annotations.ownerId, ownerId)))
    .orderBy(desc(annotations.version));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adds a version. With a `changeId` (chosen by the browser for a change made
 * offline, M12) it becomes the new version's id, so sending the same change
 * again adds nothing and returns the annotation as it stands.
 */
async function addVersion(db: Db, ownerId: string, annotationId: string, change: Partial<Row>, now: Date, changeId?: unknown) {
  if (changeId !== undefined && (typeof changeId !== "string" || !UUID.test(changeId))) throw new AnnotationError("Bad change id.");
  const all = await versions(db, ownerId, annotationId);
  const latest = all[0];
  if (changeId) {
    const [done] = await db.select({ annotationId: annotations.annotationId, ownerId: annotations.ownerId }).from(annotations).where(eq(annotations.id, changeId.toLowerCase()));
    if (done) {
      if (done.ownerId !== ownerId || done.annotationId !== latest?.annotationId) throw new AnnotationError("That change id is already taken.");
      return toAnnotation(latest, all[all.length - 1]);
    }
  }
  if (!latest || latest.deleted) throw new AnnotationError("Annotation not found.");
  const { id: _id, version, createdAt: _c, ...rest } = latest;
  void _id;
  void _c;
  const [row] = await db
    .insert(annotations)
    .values({ ...rest, ...change, ...(changeId ? { id: (changeId as string).toLowerCase() } : {}), version: version + 1, createdAt: now })
    .returning();
  return toAnnotation(row, all[all.length - 1]);
}

/** Changes colour and/or note text. Adds a new version; the old one stays. */
export async function updateAnnotation(
  db: Db,
  ownerId: string,
  annotationId: string,
  change: { color?: unknown; body?: unknown; changeId?: unknown },
  now = new Date(),
) {
  const patch: Partial<Row> = {};
  if (change.body !== undefined) patch.body = String(change.body).slice(0, MAX_BODY);
  if (change.color !== undefined) {
    if (!(COLORS as readonly string[]).includes(String(change.color))) throw new AnnotationError("Unknown colour.");
    patch.color = change.color as Color;
  }
  return addVersion(db, ownerId, annotationId, patch, now, change.changeId);
}

/** Hides an annotation (soft delete): a new version marked deleted. */
export async function deleteAnnotation(db: Db, ownerId: string, annotationId: string, now = new Date(), changeId?: unknown) {
  await addVersion(db, ownerId, annotationId, { deleted: true }, now, changeId);
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

/**
 * Adds imported annotations to a book. An annotation whose id already exists
 * is skipped, so importing twice adds nothing and nothing is overwritten.
 * Returns how many were added and skipped.
 */
export async function importAnnotations(
  db: Db,
  ownerId: string,
  bookId: string,
  items: {
    id: string | null;
    kind: Kind;
    cfi: string | null;
    quote: { exact: string; prefix: string; suffix: string };
    body: string;
    color: Color | null;
    sticker?: Sticker | null;
    drawing?: Drawing | null;
    picture?: PinnedPicture | null;
    agent?: string | null;
    created: string | null;
    modified: string | null;
  }[],
) {
  let added = 0;
  let skipped = 0;
  for (const it of items) {
    if (it.id) {
      const [exists] = await db
        .select({ id: annotations.id })
        .from(annotations)
        .where(eq(annotations.annotationId, it.id))
        .limit(1);
      if (exists) {
        skipped += 1;
        continue;
      }
    }
    const created = it.created && !Number.isNaN(Date.parse(it.created)) ? new Date(it.created) : new Date();
    const a = await createAnnotation(
      db,
      ownerId,
      { kind: it.kind, bookId, cfi: it.cfi ?? undefined, quote: it.quote, color: it.color ?? undefined, body: it.body, sticker: it.sticker ?? undefined, drawing: it.drawing ?? undefined, picture: it.picture ?? undefined },
      created,
      it.id ?? undefined,
      it.agent ?? undefined,
    );
    // Keep the "last changed" time too, as a second version.
    if (it.modified && it.modified !== it.created && !Number.isNaN(Date.parse(it.modified))) {
      await addVersion(db, ownerId, a.id, {}, new Date(it.modified));
    }
    added += 1;
  }
  return { added, skipped };
}
