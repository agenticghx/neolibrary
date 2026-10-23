import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import * as CFI from "foliate-js/epubcfi.js";
import type { Db } from "@/lib/db/client";
import { books, sections, xrayEntries, xrayMentions, type XrayKind } from "@/lib/db/schema";
import { sectionForCfi } from "./annotations";

/**
 * X-ray (M32): who and what is in a book. X1 builds the index from the text
 * alone, at no cost: the names the book writes with capitals (people, places,
 * organisations), each with every way the book spells it, and where every
 * mention is. Claude's reading (X3) later classifies the entries, merges the
 * ones this misses and adds facts with quotes.
 *
 * Mentions are character offsets into `sections.text`, whose whitespace is
 * collapsed exactly as the reader walks a paragraph (`rangeForOffsets`), so
 * X2 can underline them on the page. A test checks that every stored
 * mention's slice of the text is one of its entry's aliases.
 */
export type XrayEntry = { id: string; name: string; kind: XrayKind; aliases: string[] };
export type XrayMention = { entryId: string; sectionId: string; chapterIndex: number; position: number; start: number; end: number };
export type Paragraph = { id: string; chapterIndex: number; position: number; text: string };

export const KIND_LABELS: Record<XrayKind, string> = {
  name: "Name",
  person: "Person",
  place: "Place",
  organisation: "Organisation",
  term: "Term",
  work: "Work",
  event: "Event",
};

/** Titles that go with a name. Written before it, with or without the full stop the book uses. */
const HONORIFICS = ["Mr", "Mrs", "Ms", "Miss", "Dr", "Sir", "St", "Prof", "Messrs", "Lady", "Lord", "Captain", "Colonel", "General", "Professor", "President", "King", "Queen", "Saint", "Rev"];
const HONORIFIC_RE = new RegExp(`^(?:${HONORIFICS.join("|")})\\.?\\s`, "u");
/** Small words inside a name: "Bank of England", "Vincent van Gogh". */
const JOINERS = ["of", "de", "du", "von", "van", "da", "di", "del", "la", "le"];
const JOINER_RE = new RegExp(`^(?:${JOINERS.join("|")})$`);
/** Capitalised words that are not names: pronouns, days, months, exclamations and the like. */
const STOP = new Set(
  (
    "I A An The And But Or Nor So Yet For If Then Than When While Where What Which Who Whom Whose Why How Here There " +
    "Yes No Not Well Now Oh O Ah Alas Indeed Perhaps Pray Come Go Say Said Let Look See Hark Hush Hm Hum Tut Aye Nay " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September " +
    "October November December Spring Summer Autumn Winter Christmas Easter " +
    "God Lord Heaven Hell Satan Devil Providence Fate Nature Death " +
    "Sir Madam Mister Master Mr Mrs Ms Miss Dr Messrs " +
    "He She It They We You Me Him Her Them Us My Your His Its Our Their Mine Yours That This These Those " +
    "Is Are Was Were Be Been Am Have Has Had Do Does Did Will Would Could Should Can May Might Must Shall " +
    "In On At By To Of As With From Into Out Up Down Over Under After Before Till Until Since Because Though " +
    "Although Unless Whether Thus Hence Such Much Many More Most Less Few Several All Some Any Every Each Both " +
    "Either Neither Nothing Something Anything Everything None One Two Three Four Five Six Seven Eight Nine Ten " +
    "First Second Third Last Next Good Bad Poor Dear Very Quite Still Just Only Also Even Never Ever Always Once " +
    "Again Soon Away Back Yesterday Today Tomorrow Tonight Night Day Morning Evening Afternoon"
  ).split(" "),
);

/** One word of a name: a capital, then letters, apostrophes or hyphens ("O’Brien", "Jean-Luc"). */
const WORD = "\\p{Lu}[\\p{L}’'-]*";
const NAME_RE = new RegExp(`(?:\\b(?:${HONORIFICS.join("|")})\\.?\\s)?${WORD}(?:\\s(?:${JOINERS.join("|")})\\s${WORD}|\\s${WORD})*`, "gu");

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** A possessive or a stray quote at the end of a match is not part of the name. */
function trimName(s: string) {
  return s.replace(/[’']s$/u, "").replace(/[’'-]+$/u, "");
}

/** The name without its title: "Mr. Utterson" gives "Utterson". */
const core = (form: string) => form.replace(HONORIFIC_RE, "");
const tokens = (form: string) => core(form).split(/\s+/);
const hasHonorific = (form: string) => HONORIFIC_RE.test(form);

/**
 * Whether a match starts a sentence: the paragraph's first word, or the first
 * after a full stop, question or exclamation mark, a colon or a dash, with
 * any quotation marks and brackets in between. A word seen only there is
 * capitalised for that reason, not because it is a name.
 */
function startsSentence(text: string, at: number) {
  let i = at - 1;
  while (i >= 0 && /[\s”’"')\]]/u.test(text[i])) i -= 1;
  if (i >= 0 && /[“‘(\[]/u.test(text[i])) return true;
  return i < 0 || /[.!?:;—]/u.test(text[i]);
}

type Form = { count: number; nonInitial: number };

/**
 * The names a book writes with capitals, from its paragraphs alone. Kept: a
 * form seen at least twice and at least once inside a sentence. Forms are
 * grouped into one entry when they are the same name written differently:
 * "Hyde", "Mr. Hyde" and "Edward Hyde"; "Sir Danvers" and "Sir Danvers Carew".
 */
export function findNames(paragraphs: Paragraph[]): XrayEntry[] {
  const forms = new Map<string, Form>();
  for (const p of paragraphs) {
    for (const m of p.text.matchAll(NAME_RE)) {
      const form = trimName(m[0]);
      const words = tokens(form);
      const next = p.text[(m.index ?? 0) + m[0].length] ?? "";
      if (/\p{N}/u.test(next) || /^\p{Lu}[’'](?:m|ll|ve|d|re|s)$/u.test(m[0])) continue;
      if (!form || !words.length || !words[0] || words.every((w) => STOP.has(w) || JOINER_RE.test(w))) continue;
      if (words.some((w) => w.length < 2 && !JOINER_RE.test(w))) continue;
      if (words.length === 1 && STOP.has(words[0])) continue;
      const f = forms.get(form) ?? { count: 0, nonInitial: 0 };
      f.count += 1;
      if (!startsSentence(p.text, m.index ?? 0)) f.nonInitial += 1;
      forms.set(form, f);
    }
  }
  const kept = [...forms.entries()].filter(([, f]) => f.count >= 2 && f.nonInitial >= 1).map(([form, f]) => ({ form, ...f }));
  const known = new Set(kept.flatMap((k) => tokens(k.form)));
  for (const [form, f] of forms) {
    const words = tokens(form);
    if (f.count === 1 && words.length > 1 && words.every((w) => known.has(w) || JOINER_RE.test(w))) kept.push({ form, ...f });
  }
  const standalone = new Set(kept.filter((k) => tokens(k.form).length === 1).map((k) => core(k.form)));

  // Grouping: a form joins the group of its last word when that word stands alone as a kept form ("Hyde" for
  // "Mr. Hyde" and "Edward Hyde"); otherwise it is a group of its own ("Cavendish Square").
  const groups = new Map<string, typeof kept>();
  const keyOf = (form: string) => {
    const words = tokens(form);
    const last = words[words.length - 1];
    return words.length === 1 || standalone.has(last) ? last : core(form);
  };
  for (const k of kept) {
    const key = keyOf(k.form);
    groups.set(key, [...(groups.get(key) ?? []), k]);
  }
  // Then a group joins another when one of the other's names contains one of its names whole: "Sir Danvers" goes
  // with "Sir Danvers Carew"; a first name on its own goes with the full name.
  const contains = (longer: string, shorter: string) => longer !== shorter && ` ${longer} `.includes(` ${shorter} `);
  let merged = true;
  while (merged) {
    merged = false;
    search: for (const [a, ga] of groups) {
      for (const [b, gb] of groups) {
        if (a === b) continue;
        if (gb.some((kb) => ga.some((ka) => contains(core(kb.form), core(ka.form))))) {
          groups.set(b, [...gb, ...ga]);
          groups.delete(a);
          merged = true;
          break search;
        }
      }
    }
  }

  const entries: XrayEntry[] = [];
  for (const list of groups.values()) {
    const fullest = [...list].sort(
      (a, b) => tokens(b.form).length - tokens(a.form).length || Number(hasHonorific(b.form)) - Number(hasHonorific(a.form)) || b.count - a.count,
    );
    const name = fullest[0].form;
    const aliases = [...new Set(list.map((k) => k.form))].sort((a, b) => b.length - a.length || a.localeCompare(b));
    entries.push({ id: `x-${hash(aliases.join("|"))}`, name, kind: "name", aliases });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every place an entry's aliases occur in the paragraphs, as offsets into the
 * stored text. Longest alias first, so "Mr. Hyde" is one mention, not two; a
 * possessive ("Jekyll’s") counts, the "’s" left outside the offsets.
 */
export function findMentions(entries: XrayEntry[], paragraphs: Paragraph[]): XrayMention[] {
  const out: XrayMention[] = [];
  const matchers = entries
    .filter((e) => e.aliases.length)
    .map((e) => ({
      entryId: e.id,
      re: new RegExp(`(?<![\\p{L}\\p{N}’'])(?:${[...e.aliases].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\p{L}\\p{N}])`, "gu"),
    }));
  for (const p of paragraphs) {
    for (const { entryId, re } of matchers) {
      for (const m of p.text.matchAll(re)) {
        const start = m.index ?? 0;
        out.push({ entryId, sectionId: p.id, chapterIndex: p.chapterIndex, position: p.position, start, end: start + m[0].length });
      }
    }
  }
  return out;
}

/** Chapters that are about the file, not the book: a publisher's pages at either end. */
export const BOILERPLATE = /colophon|copyright|imprint|title ?page|about the (author|publisher)|also by|advertisement/i;

async function paragraphsOf(db: Db, bookId: string): Promise<Paragraph[]> {
  const chapters = await db
    .select({ index: sections.chapterIndex, label: sections.label, href: sections.href })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "chapter")));
  const skipped = new Set(chapters.filter((c) => BOILERPLATE.test(c.label) || BOILERPLATE.test(c.href)).map((c) => c.index));
  const rows = await db
    .select({ id: sections.id, chapterIndex: sections.chapterIndex, position: sections.position, text: sections.text })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph")))
    .orderBy(asc(sections.position));
  return rows.filter((r) => !skipped.has(r.chapterIndex));
}

async function saveMentions(db: Db, bookId: string, list: XrayMention[]) {
  await db.transaction(async (tx) => {
    await tx.delete(xrayMentions).where(eq(xrayMentions.bookId, bookId));
    for (let i = 0; i < list.length; i += 500) {
      await tx.insert(xrayMentions).values(list.slice(i, i + 500).map((m) => ({ bookId, entryId: m.entryId, sectionId: m.sectionId, chapterIndex: m.chapterIndex, position: m.position, startAt: m.start, endAt: m.end })));
    }
  });
}

/** Rebuilds a book's index from its text alone: the entries found in it, and every mention. */
export async function buildXray(db: Db, bookId: string) {
  const paragraphs = await paragraphsOf(db, bookId);
  const found = findNames(paragraphs);
  const mentions = findMentions(found, paragraphs);
  const mentioned = new Set(mentions.map((m) => m.entryId));
  const entries = found.filter((e) => mentioned.has(e.id));
  await db.transaction(async (tx) => {
    await tx.delete(xrayEntries).where(eq(xrayEntries.bookId, bookId));
    for (let i = 0; i < entries.length; i += 500) {
      await tx.insert(xrayEntries).values(entries.slice(i, i + 500).map((e) => ({ bookId, id: e.id, name: e.name, kind: e.kind, aliases: e.aliases })));
    }
  });
  await saveMentions(db, bookId, mentions);
  return { entries: entries.length, mentions: mentions.length };
}

/**
 * The index for a book, built when there is none (a book added before X-ray
 * existed), and its mentions rebuilt when the entries came in without them
 * (an imported library: mentions are derived, so the file leaves them out).
 */
export async function ensureXray(db: Db, bookId: string) {
  const [{ entries }] = await db.select({ entries: sql<number>`count(*)::int` }).from(xrayEntries).where(eq(xrayEntries.bookId, bookId));
  if (!entries) return buildXray(db, bookId);
  const [{ mentions }] = await db.select({ mentions: sql<number>`count(*)::int` }).from(xrayMentions).where(eq(xrayMentions.bookId, bookId));
  if (mentions) return null;
  const list = await db.select({ id: xrayEntries.id, name: xrayEntries.name, kind: xrayEntries.kind, aliases: xrayEntries.aliases }).from(xrayEntries).where(eq(xrayEntries.bookId, bookId));
  const found = findMentions(list, await paragraphsOf(db, bookId));
  await saveMentions(db, bookId, found);
  return { entries: list.length, mentions: found.length };
}

export type XrayChapter = { index: number; label: string; position: number };
export type XrayListEntry = XrayEntry & {
  /** Mentions in the whole book, and up to where the reader is. */
  total: number;
  soFar: number;
  /** The chapter of the first mention, and whether the reader has reached it. */
  firstChapter: number;
  seen: boolean;
  /** Per chapter with a mention: how many, and where the first one is. */
  chapters: { index: number; count: number; soFar: number; cfi: string }[];
};
export type XrayList = { chapters: XrayChapter[]; position: number; entries: XrayListEntry[] };

export class XrayError extends Error {}

/**
 * Where the reader is, as a place in the book's order (sections.position): the last paragraph on the screen
 * (the reader's place is a range covering the page, and all of it has been seen), or the chapter's start.
 */
export async function positionAt(db: Db, bookId: string, cfi: string | null): Promise<number> {
  if (!cfi) return 0;
  const end = CFI.collapse(cfi, true);
  const sectionId = await sectionForCfi(db, bookId, end);
  if (sectionId) {
    const [s] = await db.select({ position: sections.position }).from(sections).where(and(eq(sections.bookId, bookId), eq(sections.id, sectionId)));
    if (s) return s.position;
  }
  // At the very top of a chapter (before its first paragraph): the chapter's own place.
  const spine = /^epubcfi\(\/6\/(\d+)/.exec(end)?.[1];
  const [c] = spine
    ? await db
        .select({ position: sections.position })
        .from(sections)
        .where(and(eq(sections.bookId, bookId), eq(sections.kind, "chapter"), eq(sections.chapterIndex, Number(spine) / 2 - 1)))
    : [];
  return c?.position ?? 0;
}

/** The index as the Who & what tab shows it: every entry with its trail, most mentioned so far first. */
export async function listXray(db: Db, ownerId: string, bookId: string, cfi: string | null): Promise<XrayList> {
  const [book] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new XrayError("That book was not found.");
  await ensureXray(db, bookId);
  const position = await positionAt(db, bookId, cfi);
  // The trail's chapters: the book's own, as the index reads them (a publisher's pages at either end left out).
  const chapters = (
    await db
      .select({ index: sections.chapterIndex, label: sections.label, href: sections.href, position: sections.position })
      .from(sections)
      .where(and(eq(sections.bookId, bookId), eq(sections.kind, "chapter")))
      .orderBy(asc(sections.position))
  )
    .filter((c) => !BOILERPLATE.test(c.label) && !BOILERPLATE.test(c.href))
    .map(({ index, label, position }) => ({ index, label, position }));
  const rows = await db.select({ id: xrayEntries.id, name: xrayEntries.name, kind: xrayEntries.kind, aliases: xrayEntries.aliases }).from(xrayEntries).where(eq(xrayEntries.bookId, bookId));
  const counts = await db
    .select({
      entryId: xrayMentions.entryId,
      chapterIndex: xrayMentions.chapterIndex,
      count: sql<number>`count(*)::int`,
      soFar: sql<number>`count(*) filter (where ${xrayMentions.position} <= ${position})::int`,
      first: sql<number>`min(${xrayMentions.position})`,
    })
    .from(xrayMentions)
    .where(eq(xrayMentions.bookId, bookId))
    .groupBy(xrayMentions.entryId, xrayMentions.chapterIndex);
  const firsts = [...new Set(counts.map((c) => c.first))];
  const cfis = firsts.length
    ? await db.select({ position: sections.position, cfi: sections.cfi }).from(sections).where(and(eq(sections.bookId, bookId), inArray(sections.position, firsts)))
    : [];
  const cfiAt = new Map(cfis.map((c) => [c.position, c.cfi]));
  const entries: XrayListEntry[] = rows.map((e) => {
    const mine = counts.filter((c) => c.entryId === e.id).sort((a, b) => a.first - b.first);
    const total = mine.reduce((n, c) => n + c.count, 0);
    const soFar = mine.reduce((n, c) => n + c.soFar, 0);
    const first = mine[0];
    return {
      ...e,
      total,
      soFar,
      firstChapter: first?.chapterIndex ?? -1,
      seen: first ? first.first <= position : false,
      chapters: mine.map((c) => ({ index: c.chapterIndex, count: c.count, soFar: c.soFar, cfi: cfiAt.get(c.first) ?? "" })),
    };
  });
  entries.sort((a, b) => b.soFar - a.soFar || b.total - a.total || a.name.localeCompare(b.name));
  return { chapters, position, entries: entries.filter((e) => e.total > 0) };
}

export type XrayMark = { entryId: string; name: string; sectionId: string; cfi: string; start: number; end: number; position: number };

/**
 * X2: the marks for one chapter (a spine index; a PDF's page), for the page
 * to underline and the "On this page" strip: the first mention of each entry
 * in each paragraph, with the paragraph's address and the offsets into its
 * text. In reading order.
 */
export async function marksFor(db: Db, ownerId: string, bookId: string, chapterIndex: number): Promise<XrayMark[]> {
  const [book] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new XrayError("That book was not found.");
  await ensureXray(db, bookId);
  const rows = await db
    .select({ entryId: xrayMentions.entryId, name: xrayEntries.name, sectionId: xrayMentions.sectionId, cfi: sections.cfi, start: xrayMentions.startAt, end: xrayMentions.endAt, position: xrayMentions.position })
    .from(xrayMentions)
    .innerJoin(xrayEntries, and(eq(xrayEntries.bookId, xrayMentions.bookId), eq(xrayEntries.id, xrayMentions.entryId)))
    .innerJoin(sections, and(eq(sections.bookId, xrayMentions.bookId), eq(sections.id, xrayMentions.sectionId)))
    .where(and(eq(xrayMentions.bookId, bookId), eq(xrayMentions.chapterIndex, chapterIndex)))
    .orderBy(asc(xrayMentions.position), asc(xrayMentions.startAt));
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.entryId}|${r.sectionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
