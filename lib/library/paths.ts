import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, paths, pillars, slots, type Book } from "@/lib/db/schema";
import type { SeedPath, SlotKind } from "@/data/paths/types";
import { availabilityOf, isAvailable, type Availability } from "./availability";
import { audiobookBookIds, narrationOn } from "./listenable";

/**
 * Study Paths: a Path holds Pillars in reading order; a Pillar holds ordered
 * slots (N, E, extras, master key) that point at books. A title with nothing
 * to read or listen to yet exists without a file and shows greyed until its
 * file is added (labels: lib/library/availability.ts).
 */

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
};

const CORE: SlotKind[] = ["N", "E", "master"];

export function pillarProgress(slotList: SlotView[]): Pick<PillarView, "currentSlotId" | "status"> {
  const core = slotList.filter((s) => CORE.includes(s.kind));
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
 * Two small queries, not a whole Path view each: this runs on every page.
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
    return { ...p, total: own.length, started: own.filter((x) => started.has(x.id)).length };
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
        .orderBy(asc(slots.position))
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
      ...pillarProgress(slotList),
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
  };
}

/** One book with the places it appears in the user's Paths. */
export async function getBook(db: Db, ownerId: string, id: string, narration: boolean = narrationOn()) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
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
