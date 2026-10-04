import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { createAnnotation, listAnnotations, readingOrder, type Annotation } from "@/lib/library/annotations";
import { searchLibrary } from "@/lib/library/search";
import { listShelf } from "@/lib/library/shelf";
import { STICKERS } from "@/lib/library/stickers";

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

const UUID = /^[0-9a-f-]{36}$/i;
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
    .where(and(eq(books.id, bookId), eq(books.ownerId, userId), isNull(books.deletedAt)));
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
