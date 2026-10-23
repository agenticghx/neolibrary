import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { estimateCost, generate, toGeneration, type Caps, type Generation, type GenerationRequest } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, generations, sections, xrayEntries, xrayFacts, xrayMentions } from "@/lib/db/schema";
import { getStyles } from "./ai-style";
import { bookLine, styleInstruction } from "./prerequisites";
import { KIND_LABELS, XrayError, type XrayEntry } from "./xray";

/**
 * The two layers under a name's facts (M32 X4, Samuel's pick A for the card):
 * "From your library", the same name in the reader's other books, with a link
 * to each; and "From the world", Claude's general knowledge of it, asked for
 * on the card, stored once per name and style like every AI answer (ground
 * rule 5), labelled as AI and as outside the book, and always shown last.
 */
export type LibraryLink = { bookId: string; title: string; author: string; entryId: string; name: string; mentions: number; facts: number; cfi: string | null };

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;

/** An entry of this book, for its owner; throws when the book or the entry is not theirs. */
export async function entryOf(db: Db, ownerId: string, bookId: string, entryId: string): Promise<XrayEntry> {
  const [row] = await db
    .select({ id: xrayEntries.id, name: xrayEntries.name, kind: xrayEntries.kind, aliases: xrayEntries.aliases })
    .from(xrayEntries)
    .innerJoin(books, eq(books.id, xrayEntries.bookId))
    .where(and(eq(xrayEntries.bookId, bookId), eq(xrayEntries.id, entryId), eq(books.ownerId, ownerId)));
  if (!row) throw new XrayError("That name was not found.");
  return row;
}

/** The same name in the reader's other books: by any shared way of writing it, with where it first appears there. */
export async function libraryLinks(db: Db, ownerId: string, bookId: string, entry: XrayEntry): Promise<LibraryLink[]> {
  const [me] = await db.select({ editionOf: books.editionOf }).from(books).where(eq(books.id, bookId));
  const others = await db
    .select({ bookId: xrayEntries.bookId, entryId: xrayEntries.id, name: xrayEntries.name, aliases: xrayEntries.aliases, title: books.title, author: books.author, editionOf: books.editionOf })
    .from(xrayEntries)
    .innerJoin(books, eq(books.id, xrayEntries.bookId))
    .where(and(eq(books.ownerId, ownerId), ne(books.id, bookId), isNull(books.deletedAt)));
  // The same name: a shared way of writing it. A scan and its text edition are one book, not two.
  const mine = entry.aliases;
  const hits = others.filter((o) => o.editionOf !== bookId && (me?.editionOf == null || o.bookId !== me.editionOf) && o.aliases.some((a) => mine.some((b) => same(a, b))));
  if (!hits.length) return [];
  const ids = hits.map((h) => h.entryId);
  const mentions = await db
    .select({ bookId: xrayMentions.bookId, entryId: xrayMentions.entryId, count: sql<number>`count(*)::int`, first: sql<number>`min(${xrayMentions.position})` })
    .from(xrayMentions)
    .where(and(inArray(xrayMentions.entryId, ids), inArray(xrayMentions.bookId, hits.map((h) => h.bookId))))
    .groupBy(xrayMentions.bookId, xrayMentions.entryId);
  const facts = await db
    .select({ bookId: xrayFacts.bookId, entryId: xrayFacts.entryId, count: sql<number>`count(*)::int` })
    .from(xrayFacts)
    .where(and(inArray(xrayFacts.entryId, ids), inArray(xrayFacts.bookId, hits.map((h) => h.bookId))))
    .groupBy(xrayFacts.bookId, xrayFacts.entryId);
  const firsts = mentions.filter((m) => m.first != null);
  const cfis = firsts.length
    ? await db.select({ bookId: sections.bookId, position: sections.position, cfi: sections.cfi }).from(sections).where(inArray(sections.position, firsts.map((m) => m.first)))
    : [];
  return hits
    .map((h) => {
      const m = mentions.find((x) => x.bookId === h.bookId && x.entryId === h.entryId);
      const f = facts.find((x) => x.bookId === h.bookId && x.entryId === h.entryId);
      return {
        bookId: h.bookId,
        title: h.title,
        author: h.author,
        entryId: h.entryId,
        name: h.name,
        mentions: m?.count ?? 0,
        facts: f?.count ?? 0,
        cfi: m ? (cfis.find((c) => c.bookId === h.bookId && c.position === m.first)?.cfi ?? null) : null,
      };
    })
    .filter((l) => l.mentions > 0 || l.facts > 0)
    .sort((a, b) => b.mentions + b.facts - (a.mentions + a.facts) || a.title.localeCompare(b.title));
}

const MAX_TOKENS = 600;
/** The stored answer's place: not a chapter, so the entry's id under a prefix (sections' ids never start so). */
export const worldKey = (entryId: string) => `xray-world:${entryId}`;

export async function worldRequest(db: Db, ownerId: string, bookId: string, entry: XrayEntry): Promise<GenerationRequest> {
  const file = await readPrompt("xray-world");
  const { system, user } = splitPrompt(file);
  const { effective: style } = await getStyles(db, ownerId, bookId);
  const instruction = await styleInstruction(style);
  const book = await bookLine(db, bookId);
  const kind = entry.kind === "name" ? "not yet classified" : KIND_LABELS[entry.kind].toLowerCase();
  return {
    ownerId,
    bookId,
    sectionId: worldKey(entry.id),
    kind: "xray-world",
    options: { style },
    promptName: `xray-world${instruction.promptSuffix}`,
    promptHash: sha256(`${file}\n\n${instruction.text}`),
    input: `${entry.name}\n${kind}\n${book}`,
    system: fill(system, { style: instruction.text }),
    prompt: fill(user, { book, name: entry.name, kind, aliases: entry.aliases.filter((a) => a !== entry.name).join(", ") || "(no other way)" }),
    maxTokens: MAX_TOKENS,
    effort: "low",
  };
}

export type WorldView = { text: string; provenance: Generation["provenance"]; createdAt: string };
const view = (g: Generation): WorldView => ({ text: g.output.trim(), provenance: g.provenance, createdAt: g.provenance.createdAt });

/** The stored "from the world" note for a name in this reader's style, if there is one. */
export async function storedWorld(db: Db, ownerId: string, bookId: string, entry: XrayEntry): Promise<WorldView | null> {
  const { effective: style } = await getStyles(db, ownerId, bookId);
  const rows = await db
    .select()
    .from(generations)
    .where(and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), eq(generations.kind, "xray-world"), eq(generations.sectionId, worldKey(entry.id))))
    .orderBy(asc(generations.createdAt));
  const mine = rows.filter((r) => (r.options as { style?: string }).style === style);
  const last = mine.at(-1);
  return last ? view(toGeneration(last)) : null;
}

export async function estimateWorld(db: Db, model: TextModel, ownerId: string, bookId: string, entry: XrayEntry) {
  return estimateCost(model, await worldRequest(db, ownerId, bookId, entry));
}

/** Asks Claude what is generally known about the name (or re-serves the stored note). */
export async function askWorld(db: Db, model: TextModel, ownerId: string, bookId: string, entry: XrayEntry, opts: { fresh?: boolean; caps?: Caps; now?: () => Date } = {}) {
  const req = await worldRequest(db, ownerId, bookId, entry);
  const { generation, reused } = await generate(db, model, req, opts);
  return { world: view(generation), reused };
}
