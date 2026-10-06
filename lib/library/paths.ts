import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, paths, pillars, slots, type Book } from "@/lib/db/schema";
import type { SeedPath, SlotKind } from "@/data/paths/types";
import { availabilityOf, isAvailable, type Availability } from "./availability";
import { audiobookBookIds, narrationOn } from "./listenable";
import { isReadingList, STARTER_PATHS } from "./seed";

/**
 * Study Paths: a Path holds Pillars in reading order; a Pillar holds ordered
 * slots (N, E, extras, master key) that point at books. A title with nothing
 * to read or listen to yet exists without a file and shows greyed until its
 * file is added (labels: lib/library/availability.ts).
 */

/** A database id; anything else is "not found" before any query reaches the database (Postgres rejects a malformed one with an error). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lower-case, no punctuation, subtitle dropped: "Chip War: The Fight…" → "chip war". */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .split(/[:—–(]/)[0]
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Adds a Path to a user's library once. Re-running does nothing. */
export async function seedPath(db: Db, ownerId: string, seed: SeedPath): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: paths.id })
      .from(paths)
      .where(and(eq(paths.ownerId, ownerId), eq(paths.slug, seed.slug)));
    if (existing) return existing.id;

    const libraryBooks = await tx
      .select({ id: books.id, title: books.title })
      .from(books)
      .where(and(eq(books.ownerId, ownerId), isNull(books.deletedAt)));
    const byTitle = new Map(libraryBooks.map((b) => [normaliseTitle(b.title), b.id]));

    const [path] = await tx
      .insert(paths)
      .values({ ownerId, slug: seed.slug, title: seed.title, description: seed.description, sourceUrl: seed.sourceUrl })
      .returning({ id: paths.id });

    for (const [i, p] of seed.pillars.entries()) {
      const [pillar] = await tx
        .insert(pillars)
        .values({ pathId: path.id, position: i, slug: p.slug, title: p.title, question: p.question ?? "", group: p.group })
        .returning({ id: pillars.id });
      for (const [j, b] of p.books.entries()) {
        const key = normaliseTitle(b.title);
        let bookId = byTitle.get(key);
        if (!bookId) {
          const [row] = await tx
            .insert(books)
            .values({ ownerId, title: b.title, author: b.author, note: b.note ?? "", unverified: b.unverified ?? false })
            .returning({ id: books.id });
          bookId = row.id;
          byTitle.set(key, bookId);
        }
        await tx.insert(slots).values({ pillarId: pillar.id, position: j, kind: b.kind, bookId, note: b.note ?? "" });
      }
    }
    return path.id;
  });
}

export type SlotView = {
  id: string;
  kind: SlotKind;
  book: Pick<Book, "id" | "title" | "author" | "progress" | "unverified"> & { available: Availability; coverUrl: string | null };
};

export type PillarView = {
  id: string;
  slug: string;
  number: number;
  title: string;
  question: string;
  group: string;
  slots: SlotView[];
  /** The slot to read next in this pillar (first unfinished N/E/master), if any. */
  currentSlotId: string | null;
  status: "not-started" | "reading" | "done";
};

export type PathView = {
  id: string;
  slug: string;
  title: string;
  description: string;
  pillars: PillarView[];
  /** "You are here": the pillar being read now, or the next one to start. */
  currentPillarId: string | null;
  /** Distinct titles with something to read or listen to, and those with nothing yet. */
  available: number;
  notYet: number;
  /** A built-in reading list (Hidden Machinery): its own words, and only N, E and the master key count toward finishing. */
  readingList: boolean;
};

const CORE: SlotKind[] = ["N", "E", "master"];

/**
 * Where a pillar stands. In a reading list only N, E and the master key count
 * (its extras are optional); in your own Path every title counts, in your order.
 */
export function pillarProgress(slotList: SlotView[], readingList = true): Pick<PillarView, "currentSlotId" | "status"> {
  const core = readingList ? slotList.filter((s) => CORE.includes(s.kind)) : slotList;
  const current = core.find((s) => s.book.progress < 1) ?? null;
  const started = slotList.some((s) => s.book.progress > 0);
  return {
    currentSlotId: current?.id ?? null,
    status: core.length > 0 && !current ? "done" : started ? "reading" : "not-started",
  };
}

export function choosePillar(list: Pick<PillarView, "id" | "status" | "group">[]): string | null {
  const reading = list.find((p) => p.status === "reading");
  if (reading) return reading.id;
  return list.find((p) => p.status === "not-started" && p.group !== "suggested")?.id ?? null;
}

export async function listPaths(db: Db, ownerId: string) {
  return db
    .select({ id: paths.id, slug: paths.slug, title: paths.title })
    .from(paths)
    .where(eq(paths.ownerId, ownerId))
    .orderBy(asc(paths.createdAt));
}

/** Groups that are not numbered pillars of a Path (its master key; agent suggestions). */
const UNNUMBERED = ["master", "suggested"];

/**
 * The reader's Paths with how many numbered pillars are started (a pillar is
 * started when any of its books has progress), for the sidebar's "3 of 18".
 * Three small queries, not a whole Path view each: this runs on every page.
 */
export async function listPathsWithProgress(db: Db, ownerId: string) {
  const list = await listPaths(db, ownerId);
  if (!list.length) return [];
  const pillarRows = await db
    .select({ id: pillars.id, pathId: pillars.pathId, group: pillars.group })
    .from(pillars)
    .where(
      inArray(
        pillars.pathId,
        list.map((p) => p.id),
      ),
    );
  const numbered = pillarRows.filter((p) => !UNNUMBERED.includes(p.group));
  const startedRows = numbered.length
    ? await db
        .selectDistinct({ pillarId: slots.pillarId })
        .from(slots)
        .innerJoin(books, eq(books.id, slots.bookId))
        .where(
          and(
            inArray(
              slots.pillarId,
              numbered.map((p) => p.id),
            ),
            gt(books.progress, 0),
            isNull(books.deletedAt),
          ),
        )
    : [];
  const started = new Set(startedRows.map((r) => r.pillarId));
  return list.map((p) => {
    const own = numbered.filter((x) => x.pathId === p.id);
    return { ...p, total: own.length, started: own.filter((x) => started.has(x.id)).length, readingList: isReadingList(p.slug) };
  });
}

export async function getPathView(
  db: Db,
  ownerId: string,
  slug: string,
  signCover: (key: string | null) => string | null = () => null,
  narration: boolean = narrationOn(),
): Promise<PathView | null> {
  const [path] = await db
    .select()
    .from(paths)
    .where(and(eq(paths.ownerId, ownerId), eq(paths.slug, slug)));
  if (!path) return null;
  const readingList = isReadingList(path.slug);
  const pillarRows = await db.select().from(pillars).where(eq(pillars.pathId, path.id)).orderBy(asc(pillars.position));
  const slotRows = pillarRows.length
    ? await db
        .select({ slot: slots, book: books })
        .from(slots)
        .innerJoin(books, eq(books.id, slots.bookId))
        .where(
          and(
            inArray(
              slots.pillarId,
              pillarRows.map((p) => p.id),
            ),
            isNull(books.deletedAt),
          ),
        )
        .orderBy(asc(slots.position), asc(slots.id))
    : [];
  const audiobooks = await audiobookBookIds(
    db,
    ownerId,
    slotRows.map((r) => r.book.id),
  );
  const availableOf = (b: Book) => availabilityOf(b, audiobooks.has(b.id), narration);

  let number = 0;
  const pillarViews: PillarView[] = pillarRows.map((p) => {
    const slotList: SlotView[] = slotRows
      .filter((r) => r.slot.pillarId === p.id)
      .map((r) => ({
        id: r.slot.id,
        kind: r.slot.kind,
        book: {
          id: r.book.id,
          title: r.book.title,
          author: r.book.author,
          progress: r.book.progress,
          unverified: r.book.unverified,
          available: availableOf(r.book),
          coverUrl: signCover(r.book.coverKey),
        },
      }));
    if (p.group !== "master" && p.group !== "suggested") number += 1;
    return {
      id: p.id,
      slug: p.slug,
      number: p.group === "master" || p.group === "suggested" ? 0 : number,
      title: p.title,
      question: p.question,
      group: p.group,
      slots: slotList,
      ...pillarProgress(slotList, readingList),
    };
  });
  const distinct = new Map(slotRows.map((r) => [r.book.id, isAvailable(availableOf(r.book))]));
  const available = [...distinct.values()].filter(Boolean).length;
  return {
    id: path.id,
    slug: path.slug,
    title: path.title,
    description: path.description,
    pillars: pillarViews,
    currentPillarId: choosePillar(pillarViews),
    available,
    notYet: distinct.size - available,
    readingList,
  };
}

/** One book with the places it appears in the user's Paths. */
export async function getBook(db: Db, ownerId: string, id: string, narration: boolean = narrationOn()) {
  if (!UUID.test(id)) return null;
  const [book] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, id), eq(books.ownerId, ownerId), isNull(books.deletedAt)));
  if (!book) return null;
  const places = await db
    .select({ kind: slots.kind, pillar: pillars.title, pillarSlug: pillars.slug, path: paths.title, pathSlug: paths.slug })
    .from(slots)
    .innerJoin(pillars, eq(pillars.id, slots.pillarId))
    .innerJoin(paths, eq(paths.id, pillars.pathId))
    .where(eq(slots.bookId, book.id));
  const audiobook = (await audiobookBookIds(db, ownerId, [book.id])).has(book.id);
  return { book, available: availabilityOf(book, audiobook, narration), places };
}

/*
 * Your own Paths (M14 step 5, D10): a Path has a name, an optional
 * description and sections (stored as pillars); each section holds titles
 * in order (stored as slots), each a book in the library or a new title
 * with nothing available yet. Every change checks the Path is the reader's
 * and not a built-in reading list, which keeps its own order and words.
 */

export class PathError extends Error {}

const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;
const READING_LIST = "A reading list cannot be changed.";

/** A one-line name: spaces made one, capped, no space left at either end. */
const clean = (s: unknown, max = MAX_NAME) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();

/**
 * A description: its line breaks kept (a form sends CRLF; at most one blank
 * line in a row), spaces within a line made one, then capped, so a line
 * break counts as one character.
 */
const cleanLines = (s: unknown, max = MAX_DESCRIPTION) =>
  String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
    .trim();

/** An address-safe name: "Philosophy of science" → "philosophy-of-science". */
export function slugify(title: string): string {
  return normaliseTitle(title).replace(/\s+/g, "-").slice(0, 60).replace(/-+$/, "");
}

/** Path addresses taken by the app itself (/paths/new) or by the built-in reading lists. */
const RESERVED = new Set(["new", ...Object.keys(STARTER_PATHS)]);

/** The first address not taken: base, base-2, base-3, … */
function freeSlug(base: string, taken: Set<string>) {
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

/** A reading list (Hidden Machinery) keeps the order and words it came with. */
function editable(slug: string) {
  if (isReadingList(slug)) throw new PathError(READING_LIST);
}

async function ownPath(db: Db, ownerId: string, pathId: string) {
  if (!UUID.test(pathId)) throw new PathError("That path was not found.");
  const [path] = await db
    .select()
    .from(paths)
    .where(and(eq(paths.id, pathId), eq(paths.ownerId, ownerId)));
  if (!path) throw new PathError("That path was not found.");
  editable(path.slug);
  return path;
}

async function ownPillar(db: Db, ownerId: string, pillarId: string) {
  if (!UUID.test(pillarId)) throw new PathError("That section was not found.");
  const [row] = await db
    .select({ pillar: pillars, pathSlug: paths.slug })
    .from(pillars)
    .innerJoin(paths, eq(paths.id, pillars.pathId))
    .where(and(eq(pillars.id, pillarId), eq(paths.ownerId, ownerId)));
  if (!row) throw new PathError("That section was not found.");
  editable(row.pathSlug);
  return row.pillar;
}

/** A title on one of the reader's own Paths, with its book's name (for "Moved …", "Removed …"). */
async function ownSlot(db: Db, ownerId: string, slotId: string) {
  if (!UUID.test(slotId)) throw new PathError("That title was not found.");
  const [row] = await db
    .select({ slot: slots, title: books.title, pathSlug: paths.slug })
    .from(slots)
    .innerJoin(books, eq(books.id, slots.bookId))
    .innerJoin(pillars, eq(pillars.id, slots.pillarId))
    .innerJoin(paths, eq(paths.id, pillars.pathId))
    .where(and(eq(slots.id, slotId), eq(paths.ownerId, ownerId)));
  if (!row) throw new PathError("That title was not found.");
  editable(row.pathSlug);
  return { ...row.slot, title: row.title };
}

/** Makes a new, empty Path; its address is its name, made unique among the reader's Paths. */
export async function createPath(db: Db, ownerId: string, input: { title: unknown; description?: unknown }) {
  const title = clean(input.title);
  if (!title) throw new PathError("Give the path a name.");
  const description = cleanLines(input.description);
  const base = slugify(title) || "path";
  const taken = new Set([...RESERVED, ...(await listPaths(db, ownerId)).map((p) => p.slug)]);
  // Two tabs making a Path of the same name at once: the database allows one
  // address per reader, so the second insert does nothing and takes the next.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = freeSlug(base, taken);
    const [path] = await db
      .insert(paths)
      .values({ ownerId, slug, title, description })
      .onConflictDoNothing()
      .returning({ id: paths.id, slug: paths.slug });
    if (path) return path;
    taken.add(slug);
  }
  throw new PathError("That did not work. Try again.");
}

/**
 * Changes a Path's name and description (its address stays, so links keep
 * working). A description left out stays as it was; an empty one clears it.
 */
export async function renamePath(db: Db, ownerId: string, pathId: string, input: { title: unknown; description?: unknown }) {
  await ownPath(db, ownerId, pathId);
  const title = clean(input.title);
  if (!title) throw new PathError("Give the path a name.");
  await db
    .update(paths)
    .set({ title, ...(input.description == null ? {} : { description: cleanLines(input.description) }) })
    .where(eq(paths.id, pathId));
}

/** Adds a section at the end of a Path. */
export async function addSection(db: Db, ownerId: string, pathId: string, title: unknown) {
  await ownPath(db, ownerId, pathId);
  const name = clean(title);
  if (!name) throw new PathError("Give the section a name.");
  const existing = await db.select({ slug: pillars.slug, position: pillars.position }).from(pillars).where(eq(pillars.pathId, pathId));
  const base = slugify(name) || "section";
  const taken = new Set(existing.map((p) => p.slug));
  const position = existing.reduce((max, p) => Math.max(max, p.position + 1), 0);
  // As in createPath: one address per section of a Path, so a second insert at the same moment takes the next.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = freeSlug(base, taken);
    const [pillar] = await db
      .insert(pillars)
      .values({ pathId, position, slug, title: name, group: "main" })
      .onConflictDoNothing()
      .returning({ id: pillars.id, title: pillars.title });
    if (pillar) return pillar;
    taken.add(slug);
  }
  throw new PathError("That did not work. Try again.");
}

/** Words that are not part of a person's name: joining words and name particles. */
const NOT_NAMES = new Set(["and", "the", "with", "by", "et", "al", "ed", "eds", "jr", "sr", "de", "da", "di", "du", "del", "der", "den", "des", "la", "le", "van", "von"]);

/** A name's words: lower case, no accents or punctuation, initials and particles dropped ("Thomas S. Kuhn" → thomas, kuhn). */
const nameWords = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !NOT_NAMES.has(w));

/**
 * The surnames in an author line. With "&", "and" or ";" the line lists
 * people, and commas separate them too ("Brealey, Myers & Allen" → brealey,
 * myers, allen); one comma alone is "Surname, Given names" ("Le Guin,
 * Ursula K." → guin); otherwise each person's last name word ("Thomas S.
 * Kuhn" → kuhn).
 */
function surnames(author: string): Set<string> {
  const list = /&|;|\sand\s/i.test(author);
  const people = author.split(list ? /&|;|\sand\s|,/i : /;/);
  const comma = !list && (author.match(/,/g) ?? []).length === 1;
  const out = new Set<string>();
  for (const person of people) {
    const words = nameWords(comma ? person.split(",")[0] : person);
    if (comma) words.forEach((w) => out.add(w));
    else if (words.length) out.add(words[words.length - 1]);
  }
  return out;
}

/**
 * Two authors agree when either is blank or a surname matches ("Gleick,
 * James" and "James Gleick"; "Bakke" and "Gretchen Bakke"). A shared given
 * name does not count ("John Donne" and "John Keats" are two authors).
 */
export function sameAuthor(a: string, b: string): boolean {
  const x = surnames(a);
  const y = surnames(b);
  return !x.size || !y.size || [...x].some((w) => y.has(w));
}

/** Lower case, spaces made one: for comparing whole titles. */
export const plainTitle = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The whole title, normalised as normaliseTitle does but keeping any subtitle. */
const wholeTitle = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Whether a title and author could be this library book: the same short
 * title (a title with no Latin letters: the same whole title), authors that
 * agree, and not two different subtitles ("Volume I" and "Volume II" are
 * two books; "Chaos" can be "Chaos: Making a New Science").
 */
export function sameBook(title: string, author: string, book: { title: string; author: string }): boolean {
  const key = normaliseTitle(title);
  if (!key) return plainTitle(book.title) === plainTitle(title) && sameAuthor(author, book.author);
  if (normaliseTitle(book.title) !== key || !sameAuthor(author, book.author)) return false;
  const subtitled = (t: string) => wholeTitle(t) !== normaliseTitle(t);
  return !(subtitled(title) && subtitled(book.title) && wholeTitle(title) !== wholeTitle(book.title));
}

/** The one book a title could be, among those sameBook allows: the only one, or the one whose whole title matches; undefined when none or several. */
export function pickBook<T extends { title: string }>(candidates: T[], title: string): T | undefined {
  if (candidates.length === 1) return candidates[0];
  const exact = candidates.filter((b) => plainTitle(b.title) === plainTitle(title));
  return exact.length === 1 ? exact[0] : undefined;
}

/**
 * Adds a title at the end of a section: a book in the library, or a new
 * title (name and author) with nothing available yet. A new title reuses a
 * library book only when it could be that book (sameBook: short title,
 * author, subtitle); otherwise it makes a separate title. When more than one
 * book could be meant, it asks. A book already in the section is refused.
 */
export async function addTitle(
  db: Db,
  ownerId: string,
  pillarId: string,
  input: { bookId?: unknown; title?: unknown; author?: unknown; kind?: unknown },
): Promise<{ slotId: string; bookId: string; reused: boolean; title: string; author: string }> {
  await ownPillar(db, ownerId, pillarId);
  const kind: SlotKind = input.kind === "N" || input.kind === "E" ? input.kind : "extra";
  const fields = { id: books.id, title: books.title, author: books.author };
  let book: { id: string; title: string; author: string };
  let reused = false;
  if (typeof input.bookId === "string" && input.bookId) {
    const [found] = UUID.test(input.bookId)
      ? await db
          .select(fields)
          .from(books)
          .where(and(eq(books.id, input.bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt)))
      : [];
    if (!found) throw new PathError("That book was not found.");
    book = found;
  } else {
    const title = clean(input.title);
    if (!title) throw new PathError("Give the title a name.");
    const author = clean(input.author);
    const mine = await db
      .select(fields)
      .from(books)
      .where(and(eq(books.ownerId, ownerId), isNull(books.deletedAt)));
    const same = mine.filter((b) => sameBook(title, author, b));
    const match = pickBook(same, title);
    if (!match && same.length > 1) {
      throw new PathError(
        author
          ? `More than one book in your library could be ${title} by ${author}. Choose it from your library.`
          : `More than one book in your library is called ${title}. Add the author to say which, or choose it from your library.`,
      );
    }
    reused = Boolean(match);
    if (!match) book = (await db.insert(books).values({ ownerId, title, author }).returning(fields))[0];
    else book = match;
  }
  // A reading plan lists a book once per section.
  const [twice] = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.pillarId, pillarId), eq(slots.bookId, book.id)));
  if (twice) throw new PathError(`${book.title} is already in this section.`);
  const positions = await db.select({ position: slots.position }).from(slots).where(eq(slots.pillarId, pillarId));
  const position = positions.reduce((max, s) => Math.max(max, s.position + 1), 0);
  const [slot] = await db.insert(slots).values({ pillarId, position, kind, bookId: book.id }).returning({ id: slots.id });
  return { slotId: slot.id, bookId: book.id, reused, title: book.title, author: book.author };
}

/** Moves a title one place up or down within its section; at either end it stays put. Says where it is now. */
export async function moveTitle(
  db: Db,
  ownerId: string,
  slotId: string,
  direction: "up" | "down",
): Promise<{ title: string; place: number; count: number }> {
  const slot = await ownSlot(db, ownerId, slotId);
  return db.transaction(async (tx) => {
    const list = await tx
      .select({ id: slots.id, position: slots.position })
      .from(slots)
      .where(eq(slots.pillarId, slot.pillarId))
      .orderBy(asc(slots.position), asc(slots.id));
    const i = list.findIndex((s) => s.id === slotId);
    if (i < 0) throw new PathError("That title was not found.");
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return { title: slot.title, place: i + 1, count: list.length };
    // Renumber the section 0..n-1 with the two swapped (positions may have gaps or ties).
    const order = list.map((s) => s.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (const [position, id] of order.entries()) await tx.update(slots).set({ position }).where(eq(slots.id, id));
    return { title: slot.title, place: j + 1, count: list.length };
  });
}

/** Takes a title off its section (the book stays in the library). Says which. */
export async function removeTitle(db: Db, ownerId: string, slotId: string): Promise<{ title: string }> {
  const slot = await ownSlot(db, ownerId, slotId);
  await db.delete(slots).where(eq(slots.id, slotId));
  return { title: slot.title };
}
