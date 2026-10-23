import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import * as CFI from "foliate-js/epubcfi.js";
import type { Db } from "@/lib/db/client";
import { books, generations, sections, xrayEntries, xrayFacts, xrayMentions, type XrayKind } from "@/lib/db/schema";
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
    "Again Soon Away Back Yesterday Today Tomorrow Tonight Night Day Morning Evening Afternoon " +
    "Besides Finally However Thus Hence Moreover Nevertheless Therefore Meanwhile Otherwise Instead Rather Whether " +
    "Chapter Chapters Figure Figures Table Tables Section Sections Part Parts Page Pages Note Notes Index Introduction " +
    "Preface Appendix Bibliography Contents Reply Replies Objection Objections See Cf Ibid Op Loc St Prof Rev Ed Eds Vol " +
    "Fourth Fifth Sixth Seventh Eighth Ninth Tenth Meditation Meditations"
  ).split(" "),
);
/** A people's or a school's adjective is not a name on its own ("European", "Cartesian"); inside a name it stays. */
const ADJECTIVES = new Set(
  (
    "American Americans European Europeans Chinese German Germans French British English Spanish Italian Italians Russian Russians " +
    "Japanese Indian Indians Dutch Latin Greek Greeks Roman Romans Western Eastern Northern Southern Asian African Africans Arab Arabs " +
    "Christian Christians Catholic Catholics Protestant Jewish Islamic Muslim Muslims Aristotelian Cartesian Platonic Scholastic " +
    "Victorian Medieval Modern Ancient Classical Soviet Communist Socialist Liberal Conservative Republican Democratic Federal National"
  ).split(" "),
);

/** In the stop list, whatever the capitals ("CHAPTER" in a heading is "Chapter"). */
const stopped = (w: string) => STOP.has(w) || STOP.has(w[0] + w.slice(1).toLowerCase());

/** One word of a name: a capital, then letters, apostrophes or hyphens ("O’Brien", "Jean-Luc"). */
const WORD = "\\p{Lu}[\\p{L}’'&-]*";
const NAME_RE = new RegExp(`(?:\\b(?:${HONORIFICS.join("|")})\\.?\\s)?${WORD}(?:\\s(?:${JOINERS.join("|")}|&)\\s${WORD}|\\s${WORD})*`, "gu");

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

/** A heading or a title line: short, and most of its words capitalised. Title case is not evidence of a name. */
export function looksLikeHeading(text: string) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 14 || !words.length) return false;
  const caps = words.filter((w) => /^\p{Lu}/u.test(w)).length;
  return caps / words.length > 0.6;
}

/** A possessive inside a run of capitals ends the name: "Germany’s FinTech" is two names, not one. */
const breakPossessives = (text: string) => text.replace(/([’'])s(?=\s)/gu, "$1s\u2060");

/**
 * The names a book writes with capitals, from its paragraphs alone. Kept: a
 * form seen at least twice and at least once inside a sentence. Forms are
 * grouped into one entry when they are the same name written differently:
 * "Hyde", "Mr. Hyde" and "Edward Hyde"; "Sir Danvers" and "Sir Danvers Carew".
 */
export function findNames(paragraphs: Paragraph[]): XrayEntry[] {
  const forms = new Map<string, Form>();
  const lower = new Map<string, number>();
  for (const p of paragraphs) {
    for (const w of p.text.matchAll(/(?<![\p{L}’'])\p{Ll}[\p{L}]+/gu)) lower.set(w[0], (lower.get(w[0]) ?? 0) + 1);
    if (looksLikeHeading(p.text)) continue;
    const text = breakPossessives(p.text);
    for (const m of text.matchAll(NAME_RE)) {
      let form = trimName(m[0]);
      const next = text[(m.index ?? 0) + m[0].length] ?? "";
      if (/\p{N}/u.test(next) || /^\p{Lu}[’'](?:m|ll|ve|d|re|s)$/u.test(m[0])) continue;
      // A sentence opener or a title word glued to the front ("In Hawaii", "See Gaukroger", "Chapter Three") is not
      // part of the name, nor one at the end ("Fourth Objections"); nor a unit after a number ("15 MW GE"): strip
      // them, and what is left stands inside the sentence.
      let stripped = false;
      let afterNumber = false;
      const before = text.slice(0, m.index ?? 0).trimEnd();
      if (/\p{N}$/u.test(before)) {
        const first = tokens(form)[0] ?? "";
        if (tokens(form).length === 1) continue;
        if (!hasHonorific(form) && (first.length <= 3 || first === first.toUpperCase())) {
          form = form.slice(form.indexOf(" ") + 1);
          stripped = true;
        } else afterNumber = true; // a page number, a footnote mark: what follows may open a line, not a sentence
      }
      let apparatus = false;
      for (;;) {
        const words = tokens(form);
        if (words.length < 2 || hasHonorific(form)) break;
        if (stopped(words[0])) {
          form = form.slice(form.indexOf(" ") + 1);
          stripped = true;
        } else if (stopped(words[words.length - 1])) {
          // "Explanatory Notes", "Fourth Objections": a two-word title of the book's own apparatus, not a name.
          if (words.length === 2) apparatus = true;
          form = form.slice(0, form.lastIndexOf(" "));
        } else break;
        // A joiner left at an end ("of Descartes") goes with the word it joined.
        form = form.replace(new RegExp(`^(?:${JOINERS.join("|")}|&)\\s|\\s(?:${JOINERS.join("|")}|&)$`, "gu"), "");
      }
      if (apparatus) continue;
      const words = tokens(form);
      if (!form || !words.length || !words[0] || words.every((w) => stopped(w) || JOINER_RE.test(w))) continue;
      if (JOINER_RE.test(words[0]) || words[0] === "&" || JOINER_RE.test(words[words.length - 1]) || words[words.length - 1] === "&") continue;
      if (words.some((w) => w.length < 2 && !JOINER_RE.test(w) && w !== "&")) continue;
      if (words.length === 1 && (stopped(words[0]) || ADJECTIVES.has(words[0]))) continue;
      const f = forms.get(form) ?? { count: 0, nonInitial: 0 };
      f.count += 1;
      if (stripped || (!afterNumber && !startsSentence(text, m.index ?? 0))) f.nonInitial += 1;
      forms.set(form, f);
    }
  }
  const commonNoun = (form: string) => {
    const words = tokens(form);
    if (words.length !== 1) return false;
    const n = lower.get(words[0].toLowerCase()) ?? 0;
    return n >= 2 && n >= (forms.get(form)?.count ?? 0) * 0.3;
  };
  const kept = [...forms.entries()]
    .filter(([form, f]) => f.count >= 2 && f.nonInitial >= 1 && !commonNoun(form))
    .map(([form, f]) => ({ form, ...f }));
  const known = new Set(kept.flatMap((k) => tokens(k.form)));
  for (const [form, f] of forms) {
    const words = tokens(form);
    if (f.count === 1 && words.length > 1 && words.every((w) => known.has(w) || JOINER_RE.test(w))) kept.push({ form, ...f });
  }
  const standalone = new Set(kept.filter((k) => tokens(k.form).length === 1).map((k) => core(k.form)));
  // A last word that ends many different names ("Bank", "Energy", "Edison" the companies) is a kind of thing, not a
  // surname: it groups nothing.
  const endings = new Map<string, Set<string>>();
  for (const k of kept) {
    const words = tokens(k.form);
    if (words.length > 1) (endings.get(words[words.length - 1]) ?? endings.set(words[words.length - 1], new Set()).get(words[words.length - 1]))!.add(core(k.form));
  }
  const surnameLike = (w: string) => standalone.has(w) && (endings.get(w)?.size ?? 0) <= 2;

  // Grouping: a form joins the group of its last word when that word stands alone as a kept form and is a name's
  // end, not a kind of thing ("Hyde" for "Mr. Hyde" and "Edward Hyde"); otherwise it is a group of its own.
  const groups = new Map<string, typeof kept>();
  const keyOf = (form: string) => {
    const words = tokens(form);
    const last = words[words.length - 1];
    return words.length === 1 || surnameLike(last) ? last : core(form);
  };
  for (const k of kept) {
    const key = keyOf(k.form);
    groups.set(key, [...(groups.get(key) ?? []), k]);
  }
  // Then a group joins another when one of its names is the start or the end of one of the other's longer names
  // ("Sir Danvers" and "Sir Danvers Carew"; "Richard" and "Richard Enfield"), and there is exactly one such other
  // group: a word shared in the middle ("French", "American") joins nothing, and a first name two people share
  // stays on its own. One pass, so nothing chains.
  const atAnEnd = (longer: string, shorter: string) => {
    if (longer === shorter) return false;
    const l = longer.split(" ");
    const s = shorter.split(" ");
    if (s.length >= l.length) return false;
    return s.every((w, i) => w === l[i]) || s.every((w, i) => w === l[l.length - s.length + i]);
  };
  const before = [...groups.entries()];
  for (const [a, ga] of before) {
    if (!groups.has(a)) continue;
    const targets = before.filter(([b, gb]) => b !== a && groups.has(b) && gb.some((kb) => ga.some((ka) => atAnEnd(core(kb.form), core(ka.form)))));
    if (targets.length !== 1) continue;
    const [b, gb] = targets[0];
    groups.set(b, [...(groups.get(b) ?? gb), ...ga]);
    groups.delete(a);
  }

  const entries: XrayEntry[] = [];
  for (const list of groups.values()) {
    // The name shown: the way the book most often writes it in full (a first name and a surname), else with its
    // title, else the single word; never a form seen once.
    const length = (form: string) => form.split(" ").length;
    const byCount = [...list].sort((a, b) => b.count - a.count || length(b.form) - length(a.form));
    const plain = byCount.filter((k) => k.count >= 2 && tokens(k.form).length > 1 && !hasHonorific(k.form) && !tokens(k.form).some((w) => JOINER_RE.test(w)));
    const titled = byCount.filter((k) => k.count >= 2 && length(k.form) > 1);
    const base = (plain[0] ?? titled[0] ?? byCount[0]).form;
    // Written in full once ("Sir Danvers Carew" for "Sir Danvers"), the fuller form is the name.
    const longer = list.filter((k) => k.form.startsWith(`${base} `)).sort((a, b) => b.form.length - a.form.length);
    const name = longer[0]?.form ?? base;
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
    const found: { entryId: string; start: number; end: number }[] = [];
    for (const { entryId, re } of matchers) {
      for (const m of p.text.matchAll(re)) found.push({ entryId, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    }
    // One name per span: the longest wins, so "Energy" inside "Department of Energy" is that department's mention.
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    let upTo = -1;
    for (const f of found) {
      if (f.start < upTo) continue;
      upTo = f.end;
      out.push({ entryId: f.entryId, sectionId: p.id, chapterIndex: p.chapterIndex, position: p.position, start: f.start, end: f.end });
    }
  }
  return out;
}

/** Chapters that are about the file, not the book: a publisher's pages at either end. */
export const BOILERPLATE = /colophon|copyright|imprint|title ?page|about the (author|publisher)|also by|advertisement/i;

/** The book's own paragraphs, in order: what the index reads and what mentions are found in. */
export async function paragraphsOf(db: Db, bookId: string): Promise<Paragraph[]> {
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

/** Replaces a book's mentions. */
export async function saveMentions(db: Db, bookId: string, list: XrayMention[]) {
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
  const counts = new Map<string, number>();
  for (const m of findMentions(found, paragraphs)) counts.set(m.entryId, (counts.get(m.entryId) ?? 0) + 1);
  // A name with fewer than two mentions of its own (not inside a longer name) is not worth an entry.
  const entries = found.filter((e) => (counts.get(e.id) ?? 0) >= 2);
  const mentions = findMentions(entries, paragraphs);
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
/** X3: one thing the book says about an entry, with the quote it rests on and where that is. */
export type XrayFact = { id: string; chapterIndex: number; sectionId: string; cfi: string; position: number; start: number; end: number; fact: string; quote: string; seen: boolean; model: string; readAt: string };
export type XrayListEntry = XrayEntry & {
  /** Mentions in the whole book, and up to where the reader is. */
  total: number;
  soFar: number;
  /** The chapter of the first mention, and whether the reader has reached it. */
  firstChapter: number;
  seen: boolean;
  /** Per chapter with a mention: how many, and where the first one is. */
  chapters: { index: number; count: number; soFar: number; cfi: string }[];
  /** What Claude read about it (X3), in the book's order; `seen` says the reader has reached that place. */
  facts: XrayFact[];
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
  const factRows = await db
    .select({ id: xrayFacts.id, entryId: xrayFacts.entryId, chapterIndex: xrayFacts.chapterIndex, sectionId: xrayFacts.sectionId, cfi: sections.cfi, position: xrayFacts.position, start: xrayFacts.startAt, end: xrayFacts.endAt, fact: xrayFacts.fact, quote: xrayFacts.quote, model: generations.model, readAt: generations.createdAt })
    .from(xrayFacts)
    .innerJoin(sections, and(eq(sections.bookId, xrayFacts.bookId), eq(sections.id, xrayFacts.sectionId)))
    .innerJoin(generations, eq(generations.id, xrayFacts.generationId))
    .where(eq(xrayFacts.bookId, bookId))
    .orderBy(asc(xrayFacts.position), asc(xrayFacts.startAt), asc(xrayFacts.createdAt));
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
      facts: factRows
        .filter((f) => f.entryId === e.id)
        .map((f) => ({ id: f.id, chapterIndex: f.chapterIndex, sectionId: f.sectionId, cfi: f.cfi, position: f.position, start: f.start, end: f.end, fact: f.fact, quote: f.quote, model: f.model, readAt: f.readAt.toISOString(), seen: f.position <= position })),
    };
  });
  entries.sort((a, b) => b.soFar - a.soFar || b.total - a.total || a.name.localeCompare(b.name));
  return { chapters, position, entries: entries.filter((e) => e.total > 0 || e.facts.length > 0) };
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
