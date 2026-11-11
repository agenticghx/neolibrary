import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { createAnnotation, listAnnotations, readingOrder, type Annotation } from "@/lib/library/annotations";
import { searchLibrary } from "@/lib/library/search";
import { listShelf } from "@/lib/library/shelf";
import { STICKERS } from "@/lib/library/stickers";
import { editionOf, pdfHasOwnText } from "@/lib/library/text-edition";
import { listXray, XrayError } from "@/lib/library/xray";
import { isOwnBook } from "@/lib/library/own-book";

/**
 * What an AI agent can do in a reader's library (M11), shared by the HTTP
 * agent API (/api/agent/*) and the MCP server. Every function takes the
 * token's user and sees only that user's books and notes. Answers are plain
 * JSON with short field names, written for a language model to read.
 */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE = 10_000;

export type AgentBook = { id: string; title: string; author: string; progress: number; lastOpenedAt: string | null };

/** The reader's own books with a file (not the "wanted" ones), by title; `q` filters by title or author. */
export async function agentBooks(db: Db, userId: string, q?: string): Promise<AgentBook[]> {
  const list = await listShelf(db, userId, { sort: "title", q: q?.slice(0, 100) });
  return list.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    progress: Math.round(b.progress * 100) / 100,
    lastOpenedAt: b.lastOpenedAt?.toISOString() ?? null,
  }));
}

export type AgentHit = { bookId: string; bookTitle: string; chapter: string; sectionId: string; text: string };

/** Full-text search over the reader's books; matched words are wrapped in **double asterisks**. */
export async function agentSearch(db: Db, userId: string, query: string, limit = 20): Promise<AgentHit[]> {
  const q = query.trim();
  if (!q) throw new AgentError("Say what to search for.");
  const hits = await searchLibrary(db, userId, q, Math.max(1, Math.min(50, Math.floor(limit) || 20)));
  return hits.map((h) => ({
    bookId: h.bookId,
    bookTitle: h.bookTitle,
    chapter: h.chapter,
    sectionId: h.sectionId,
    text: h.snippet.map((p) => (p.match ? `**${p.text}**` : p.text)).join(""),
  }));
}

export type AgentNote = {
  id: string;
  kind: string;
  /** The passage it is attached to (empty for a note on the whole book). */
  quote: string;
  /** What the reader (or an agent) wrote, a sticker's name, or a voice note's transcript. */
  note: string;
  color: string | null;
  sectionId: string | null;
  /** Set when an AI agent added it: the API token's name. */
  addedByAgent: string | null;
  createdAt: string;
  updatedAt: string;
};

async function ownBook(db: Db, userId: string, bookId: string) {
  if (!UUID.test(bookId)) throw new AgentError("Book not found.", 404);
  const [b] = await db
    .select({ id: books.id, title: books.title })
    .from(books)
    .where(isOwnBook(bookId, userId));
  if (!b) throw new AgentError("Book not found.", 404);
  return b;
}

const toNote = (a: Annotation): AgentNote => ({
  id: a.id,
  kind: a.drawing ? "handwritten note" : a.picture ? "pinned picture" : a.kind,
  quote: a.quote.exact,
  note: [a.sticker ? `Sticker: ${STICKERS[a.sticker].label}` : "", a.body.trim(), a.voice?.transcript.trim() ? `Voice note: ${a.voice.transcript.trim()}` : ""]
    .filter(Boolean)
    .join("\n\n"),
  color: a.color,
  sectionId: a.sectionId,
  addedByAgent: a.agent,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

/** The reader's current highlights, bookmarks and notes on one book, in reading order. */
export async function agentNotes(db: Db, userId: string, bookId: string): Promise<AgentNote[]> {
  await ownBook(db, userId, bookId);
  return (await listAnnotations(db, userId, bookId)).sort(readingOrder).map(toNote);
}

/**
 * A range CFI over a whole paragraph, from its element CFI: from its first
 * character to the position just after it (`/178` becomes `,/178/1:0,/179:0`),
 * so the reader can draw the highlight. Falls back to the element CFI.
 */
export function paragraphRange(cfi: string) {
  const m = /^epubcfi\((.+!.*?)\/(\d+)(\[[^\]]*\])?\)$/.exec(cfi);
  if (!m || Number(m[2]) % 2 !== 0) return cfi;
  const step = Number(m[2]);
  return `epubcfi(${m[1]},/${step}${m[3] ?? ""}/1:0,/${step + 1}:0)`;
}

/**
 * Adds a note as the agent. With a `sectionId` (from a search result) it is
 * attached to that paragraph, which is highlighted in the agent colour (sky);
 * without, it is a note on the whole book. Always marked with the token's
 * name, so the reader sees an agent wrote it.
 */
export async function agentAddNote(db: Db, userId: string, agent: string, input: { bookId: string; text: unknown; sectionId?: unknown }) {
  await ownBook(db, userId, input.bookId);
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new AgentError("Write the note's text.");
  if (text.length > MAX_NOTE) throw new AgentError(`A note can be at most ${MAX_NOTE} characters.`);
  if (input.sectionId === undefined || input.sectionId === null || input.sectionId === "") {
    return toNote(await createAnnotation(db, userId, { kind: "note", bookId: input.bookId, body: text }, new Date(), undefined, agent));
  }
  const [s] =
    typeof input.sectionId === "string"
      ? await db
          .select({ cfi: sections.cfi, text: sections.text, label: sections.label, kind: sections.kind })
          .from(sections)
          .where(and(eq(sections.bookId, input.bookId), eq(sections.id, input.sectionId)))
      : [];
  if (!s || s.kind === "chapter") throw new AgentError("No such paragraph in this book. Use a sectionId from a search result.", 404);
  const quote = (s.text || s.label).trim();
  return toNote(
    await createAnnotation(
      db,
      userId,
      { kind: "highlight", bookId: input.bookId, cfi: paragraphRange(s.cfi), quote: { exact: quote }, color: "sky", body: text },
      new Date(),
      undefined,
      agent,
    ),
  );
}

export type AgentBookDetails = {
  id: string;
  title: string;
  author: string;
  /** "epub" or "pdf"; null for a title still waiting for its file. */
  kind: "epub" | "pdf" | null;
  pages: number | null;
  bytes: number | null;
  /** A PDF whose pages are pictures (fewer than half its pages carry text of their own): it needs a text edition (M25). */
  scan: boolean;
  /** The text edition made from this scan, if any (its own book id). */
  textEdition: string | null;
  /** On a text edition: the scan it was made from. */
  editionOf: string | null;
  cover: { has: boolean; source: string | null; catalogue: string | null; checkedAt: string | null };
  isbn: string | null;
};

/**
 * One of the reader's own books in detail (M40 S4), for checks run with the owner's token: what kind of file it has,
 * whether it is a scan and has its text edition, and where its cover came from. Finds a text edition too (hidden from
 * the shelf). Another reader's book, or one in the bin, is "not found".
 */
export async function agentBook(db: Db, userId: string, bookId: string): Promise<AgentBookDetails> {
  if (!UUID.test(bookId)) throw new AgentError("Book not found.", 404);
  const [b] = await db
    .select()
    .from(books)
    .where(isOwnBook(bookId, userId));
  if (!b) throw new AgentError("Book not found.", 404);
  const scan = b.fileType === "pdf" && !b.editionOf && !(await pdfHasOwnText(db, b.id, b.pageCount));
  const edition = b.fileType === "pdf" ? await editionOf(db, userId, b.id) : null;
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    kind: b.fileKey ? b.fileType : null,
    pages: b.pageCount,
    bytes: b.fileSize,
    scan,
    textEdition: edition?.id ?? null,
    editionOf: b.editionOf,
    cover: { has: Boolean(b.coverKey), source: b.coverSource, catalogue: b.coverPage, checkedAt: b.coverCheckedAt?.toISOString() ?? null },
    isbn: b.isbn,
  };
}

/** The storage key and type of one of the reader's own book files (M40 S4), or "not found". */
export async function agentBookFile(db: Db, userId: string, bookId: string) {
  if (!UUID.test(bookId)) throw new AgentError("Book not found.", 404);
  const [b] = await db
    .select({ fileKey: books.fileKey, fileType: books.fileType, fileName: books.fileName, title: books.title })
    .from(books)
    .where(isOwnBook(bookId, userId));
  if (!b?.fileKey || !b.fileType) throw new AgentError("Book not found, or it has no file yet.", 404);
  return { key: b.fileKey, type: b.fileType, name: b.fileName ?? `${b.title}.${b.fileType}` };
}

export type AgentXrayEntry = { name: string; kind: string; aliases: string[]; mentions: number; facts: { chapter: number; fact: string; quote: string; cfi: string }[] };

/** A book's whole X-ray (M40 S4): every entry, most mentioned first, with each fact and the book's own words for it. */
export async function agentXray(db: Db, userId: string, bookId: string): Promise<AgentXrayEntry[]> {
  if (!UUID.test(bookId)) throw new AgentError("Book not found.", 404);
  try {
    const list = await listXray(db, userId, bookId, null);
    return [...list.entries].sort((a, b) => b.total - a.total).map((e) => ({
      name: e.name,
      kind: e.kind,
      aliases: e.aliases,
      mentions: e.total,
      facts: e.facts.map((f) => ({ chapter: f.chapterIndex, fact: f.fact, quote: f.quote, cfi: f.cfi })),
    }));
  } catch (e) {
    if (e instanceof XrayError) throw new AgentError("Book not found.", 404);
    throw e;
  }
}
