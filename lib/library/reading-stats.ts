import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, paths, pillars, readingSessions, slots, type ChapterReading } from "@/lib/db/schema";

/**
 * Reading statistics (M10). The reader measures a sitting and reports it in
 * small batches; each report carries the sitting's running totals, so a
 * repeated or late report never counts anything twice (the larger total wins).
 */
export class StatsError extends Error {}

/** Longest believable sitting, so a broken clock cannot inflate the numbers. */
const MAX_SECONDS = 12 * 60 * 60;
const MAX_WORDS = 500_000;

export async function recordReading(
  db: Db,
  ownerId: string,
  input: { sessionId: unknown; bookId: string; startedAt: unknown; activeSeconds: unknown; words: unknown; pages: unknown; chapters?: unknown },
  now = new Date(),
) {
  if (typeof input.sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.sessionId)) throw new StatsError("Bad session.");
  const [book] = /^[0-9a-f-]{36}$/i.test(input.bookId)
    ? await db.select({ id: books.id }).from(books).where(and(eq(books.id, input.bookId), eq(books.ownerId, ownerId)))
    : [];
  if (!book) throw new StatsError("Book not found");
  const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const activeSeconds = int(input.activeSeconds, MAX_SECONDS);
  const words = int(input.words, MAX_WORDS);
  const pages = int(input.pages, 100_000);
  const chapters = cleanChapters(input.chapters, activeSeconds, words);
  const started = new Date(String(input.startedAt));
  const startedAt = Number.isNaN(started.getTime()) || started > now ? now : started;
  // Upsert: the sitting's totals only grow; a session belongs to its first owner and book.
  await db
    .insert(readingSessions)
    .values({ id: input.sessionId, ownerId, bookId: input.bookId, startedAt, endedAt: now, activeSeconds, words, pages, chapters })
    .onConflictDoUpdate({
      target: readingSessions.id,
      set: {
        endedAt: now,
        activeSeconds: sql`greatest(${readingSessions.activeSeconds}, ${activeSeconds})`,
        words: sql`greatest(${readingSessions.words}, ${words})`,
        pages: sql`greatest(${readingSessions.pages}, ${pages})`,
        // The chapter split of the newest report, unless it is a late one (less time than stored).
        chapters: sql`case when ${activeSeconds} >= ${readingSessions.activeSeconds} then ${JSON.stringify(chapters)}::jsonb else ${readingSessions.chapters} end`,
      },
      setWhere: and(eq(readingSessions.ownerId, ownerId), eq(readingSessions.bookId, input.bookId)),
    });
}

const MAX_CHAPTERS = 500;

/** The reader's chapter split, checked: known fields only, sane numbers, never more than the sitting's totals. */
export function cleanChapters(raw: unknown, activeSeconds: number, words: number): ChapterReading[] {
  if (!Array.isArray(raw)) return [];
  const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const seen = new Set<string>();
  const list: ChapterReading[] = [];
  for (const c of raw.slice(0, MAX_CHAPTERS)) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key.slice(0, 300) : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const position = Number(r.position);
    list.push({
      key,
      label: typeof r.label === "string" ? r.label.replace(/\s+/g, " ").trim().slice(0, 200) : "",
      position: Number.isFinite(position) ? Math.max(0, Math.min(1, position)) : 0,
      activeSeconds: int(r.activeSeconds, activeSeconds),
      words: int(r.words, words),
    });
  }
  return list;
}

/**
 * Speed counts only real reading: a sitting of at least a minute, at no more
 * than 1,000 words per minute (above that, comprehension is lost: Rayner et
 * al. 2016, cited by Brysbaert 2019). Flicking through pages adds words read,
 * but not speed.
 */
export const SPEED_MIN_SECONDS = 60;
export const SPEED_MAX_WPM = 1000;

export function countsForSpeed(words: number, activeSeconds: number) {
  return activeSeconds >= SPEED_MIN_SECONDS && words * 60 <= SPEED_MAX_WPM * activeSeconds;
}

/** Words per minute, rounded, or null when there is too little reading to say (under a minute). */
export function wordsPerMinute(words: number, activeSeconds: number) {
  if (activeSeconds < 60) return null;
  return Math.round(words / (activeSeconds / 60));
}

/** `speedWords`/`speedSeconds` are the totals of the sittings that count for speed (see countsForSpeed). */
type Speed = { speedWords: number; speedSeconds: number };

export type BookStats = Speed & {
  bookId: string;
  title: string;
  author: string;
  activeSeconds: number;
  words: number;
  pages: number;
  sessions: number;
  wpm: number | null;
};

const counted = sql`${readingSessions.activeSeconds} >= ${SPEED_MIN_SECONDS} and ${readingSessions.words} * 60 <= ${SPEED_MAX_WPM} * ${readingSessions.activeSeconds}`;

/** Totals per book for one reader, most read first. */
export async function statsByBook(db: Db, ownerId: string): Promise<BookStats[]> {
  const rows = await db
    .select({
      bookId: readingSessions.bookId,
      title: books.title,
      author: books.author,
      activeSeconds: sql<number>`sum(${readingSessions.activeSeconds})::int`,
      words: sql<number>`sum(${readingSessions.words})::int`,
      pages: sql<number>`sum(${readingSessions.pages})::int`,
      sessions: sql<number>`count(*)::int`,
      speedWords: sql<number>`coalesce(sum(case when ${counted} then ${readingSessions.words} else 0 end), 0)::int`,
      speedSeconds: sql<number>`coalesce(sum(case when ${counted} then ${readingSessions.activeSeconds} else 0 end), 0)::int`,
    })
    .from(readingSessions)
    .innerJoin(books, eq(books.id, readingSessions.bookId))
    .where(eq(readingSessions.ownerId, ownerId))
    .groupBy(readingSessions.bookId, books.title, books.author)
    .orderBy(sql`sum(${readingSessions.activeSeconds}) desc`, asc(books.title));
  return rows.map((r) => ({ ...r, wpm: wordsPerMinute(r.speedWords, r.speedSeconds) }));
}

/** Totals for a group of books (a pillar, or all N books), each book counted once. */
export type GroupStats = { activeSeconds: number; words: number; books: number; wpm: number | null };

export type PillarStats = GroupStats & { pillarId: string; title: string; path: string };

export type KindStats = GroupStats & { kind: "N" | "E" | "extra" | "master" };

const sum = (list: BookStats[]): GroupStats => {
  const total = (k: "activeSeconds" | "words" | "speedWords" | "speedSeconds") => list.reduce((n, b) => n + b[k], 0);
  return { activeSeconds: total("activeSeconds"), words: total("words"), books: list.length, wpm: wordsPerMinute(total("speedWords"), total("speedSeconds")) };
};

/**
 * Your reading grouped by where the books sit on your Paths: by pillar, and by
 * slot kind (N = narrative, read first; E = engineering, read second). A book
 * in two pillars counts in both; within one group each book counts once.
 */
export async function statsByPathSlot(db: Db, ownerId: string, byBook?: BookStats[]) {
  const read = byBook ?? (await statsByBook(db, ownerId));
  const stats = new Map(read.map((b) => [b.bookId, b]));
  const placed = read.length
    ? await db
        .select({ bookId: slots.bookId, kind: slots.kind, pillarId: pillars.id, title: pillars.title, path: paths.title })
        .from(slots)
        .innerJoin(pillars, eq(pillars.id, slots.pillarId))
        .innerJoin(paths, eq(paths.id, pillars.pathId))
        .where(eq(paths.ownerId, ownerId))
        .orderBy(asc(paths.title), asc(pillars.position), asc(slots.position))
    : [];
  const pillarBooks = new Map<string, { title: string; path: string; books: Set<string> }>();
  const kindBooks = new Map<KindStats["kind"], Set<string>>();
  for (const p of placed) {
    if (!stats.has(p.bookId)) continue;
    const pillar = pillarBooks.get(p.pillarId) ?? { title: p.title, path: p.path, books: new Set<string>() };
    pillar.books.add(p.bookId);
    pillarBooks.set(p.pillarId, pillar);
    kindBooks.set(p.kind, (kindBooks.get(p.kind) ?? new Set<string>()).add(p.bookId));
  }
  const pick = (ids: Set<string>) => sum([...ids].map((id) => stats.get(id)!));
  const pillarList: PillarStats[] = [...pillarBooks].map(([pillarId, p]) => ({ pillarId, title: p.title, path: p.path, ...pick(p.books) }));
  const kinds: KindStats[] = (["N", "E", "master", "extra"] as const)
    .filter((k) => kindBooks.has(k))
    .map((kind) => ({ kind, ...pick(kindBooks.get(kind)!) }));
  return { pillars: pillarList, kinds };
}

export type WeekStats = { weekStart: string; activeSeconds: number; words: number; sessions: number; wpm: number | null };

const DAY = 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week holding this moment, as YYYY-MM-DD. */
export function weekStart(at: Date) {
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const monday = day - ((at.getUTCDay() + 6) % 7) * DAY;
  return new Date(monday).toISOString().slice(0, 10);
}

/**
 * Time and words per week (weeks start on Monday, UTC), oldest first, for the
 * last `weeks` weeks up to the one holding `now`. It starts at your first
 * week with any reading; weeks without reading in between are kept as zeros.
 */
export async function statsByWeek(db: Db, ownerId: string, now = new Date(), weeks = 12): Promise<WeekStats[]> {
  const first = new Date(weekStart(now)).getTime() - (weeks - 1) * 7 * DAY;
  const rows = await db
    .select({ startedAt: readingSessions.startedAt, activeSeconds: readingSessions.activeSeconds, words: readingSessions.words })
    .from(readingSessions)
    .where(and(eq(readingSessions.ownerId, ownerId), gte(readingSessions.startedAt, new Date(first))));
  if (rows.length === 0) return [];
  type Week = { activeSeconds: number; words: number; sessions: number } & Speed;
  const empty: Week = { activeSeconds: 0, words: 0, sessions: 0, speedWords: 0, speedSeconds: 0 };
  const byWeek = new Map<string, Week>();
  for (const r of rows) {
    const w = weekStart(r.startedAt);
    const t = byWeek.get(w) ?? empty;
    const speed = countsForSpeed(r.words, r.activeSeconds);
    byWeek.set(w, {
      activeSeconds: t.activeSeconds + r.activeSeconds,
      words: t.words + r.words,
      sessions: t.sessions + 1,
      speedWords: t.speedWords + (speed ? r.words : 0),
      speedSeconds: t.speedSeconds + (speed ? r.activeSeconds : 0),
    });
  }
  const earliest = [...byWeek.keys()].sort()[0];
  const list: WeekStats[] = [];
  for (let t = new Date(earliest).getTime(); t <= new Date(weekStart(now)).getTime(); t += 7 * DAY) {
    const w = new Date(t).toISOString().slice(0, 10);
    const { speedWords, speedSeconds, ...v } = byWeek.get(w) ?? empty;
    list.push({ weekStart: w, ...v, wpm: wordsPerMinute(speedWords, speedSeconds) });
  }
  return list;
}

export type ChapterStats = { key: string; label: string; position: number; activeSeconds: number; words: number; wpm: number };

export type Suggestion = {
  bookId: string;
  title: string;
  /** The chapter's link in the book's contents (unique within the book). */
  chapterKey: string;
  chapter: string;
  chapterWpm: number;
  usualWpm: number;
};

/** A chapter needs this much countable reading before its speed is used. */
export const CHAPTER_MIN_SECONDS = 120;
/** And a book needs this many such chapters before anything is suggested. */
export const CHAPTERS_NEEDED = 3;
/** "Drops sharply": under this share of the book's usual (median) chapter speed. */
export const SHARP_DROP = 0.6;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Per-chapter speed for each book, from the chapter split of every sitting.
 * The speed rule applies to each chapter piece of a sitting (a minute or more,
 * at most 1,000 words per minute); a chapter's speed is used once it has two
 * minutes of such reading. Chapters in reading order (position in the book).
 */
export async function chapterStatsByBook(db: Db, ownerId: string) {
  const rows = await db
    .select({ bookId: readingSessions.bookId, title: books.title, chapters: readingSessions.chapters })
    .from(readingSessions)
    .innerJoin(books, eq(books.id, readingSessions.bookId))
    .where(eq(readingSessions.ownerId, ownerId));
  const byBook = new Map<string, { title: string; chapters: Map<string, Omit<ChapterStats, "wpm">> }>();
  for (const r of rows) {
    const book = byBook.get(r.bookId) ?? { title: r.title, chapters: new Map() };
    byBook.set(r.bookId, book);
    for (const c of r.chapters) {
      if (!countsForSpeed(c.words, c.activeSeconds)) continue;
      const t = book.chapters.get(c.key) ?? { key: c.key, label: c.label, position: c.position, activeSeconds: 0, words: 0 };
      book.chapters.set(c.key, { ...t, position: Math.min(t.position, c.position), activeSeconds: t.activeSeconds + c.activeSeconds, words: t.words + c.words });
    }
  }
  return [...byBook].map(([bookId, b]) => ({
    bookId,
    title: b.title,
    chapters: [...b.chapters.values()]
      .filter((c) => c.activeSeconds >= CHAPTER_MIN_SECONDS)
      .sort((x, y) => x.position - y.position)
      .map((c) => ({ ...c, wpm: wordsPerMinute(c.words, c.activeSeconds)! })),
  }));
}

/**
 * Simple, honest suggestions: in a book with at least three chapters of
 * enough reading, a chapter read at under 60% of that book's usual (median)
 * chapter speed is named, with the panel that explains background.
 */
export function suggestionsFrom(books: { bookId: string; title: string; chapters: ChapterStats[] }[]): Suggestion[] {
  const list: Suggestion[] = [];
  for (const b of books) {
    if (b.chapters.length < CHAPTERS_NEEDED) continue;
    const usual = median(b.chapters.map((c) => c.wpm));
    for (const c of b.chapters) {
      if (c.wpm < usual * SHARP_DROP) list.push({ bookId: b.bookId, title: b.title, chapterKey: c.key, chapter: c.label || "One chapter", chapterWpm: c.wpm, usualWpm: Math.round(usual) });
    }
  }
  return list;
}
