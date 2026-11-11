import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { isOwnBook } from "@/lib/library/own-book";

/**
 * M41 R5: a paper's in-text citations, shown as written ("(Waud and Parker, 1971)"), as numbers ("[12]") or hidden.
 *
 * Written for the sessions that change it. A citation in the author–year style names authors and a year; the
 * reference list at the paper's end holds one entry per work. This finds the reference list (a chapter, or a heading
 * paragraph, called References, Bibliography, Literature Cited or Works Cited), numbers its entries in the order they
 * are printed (the list stays where it is, so its numbers read 1, 2, 3 down the page), and finds each citation in the
 * prose with the entry it names. Nothing is stored: it is worked out from the paragraphs' stored text each time a
 * paper opens, and the reader changes only what is drawn (Reader.tsx, `citations.ts` beside it), never the text.
 *
 * Accuracy first: a citation is numbered only when every work it names matches exactly one entry. One that matches
 * none, or two (a year printed without the letter that tells two works apart), stays as written, and is counted.
 */

export type CitationParagraph = { id: string; cfi: string; chapterIndex: number; position: number; text: string; form?: string | null };
export type ChapterLabel = { chapterIndex: number; label: string; href: string };

/** One entry of the reference list, numbered in printed order. */
export type Reference = { n: number; sectionId: string; cfi: string; chapterIndex: number; text: string };
/** One citation in the prose: offsets into its paragraph's stored text, and what to show in its place. */
export type Citation = {
  sectionId: string;
  cfi: string;
  chapterIndex: number;
  start: number;
  end: number;
  /** "[12]", "[3, 7–9]", or "(e.g., [5])" when the citation opens with words of its own. */
  label: string;
  numbers: number[];
};
export type Unmatched = { sectionId: string; at: number; text: string; why: "no entry" | "two entries" };
export type PaperCitations = { references: Reference[]; citations: Citation[]; unmatched: Unmatched[] };

const NONE: PaperCitations = { references: [], citations: [], unmatched: [] };

/** A reference list's heading or chapter label: "References", "XII. References", "4 Bibliography". */
export const REFERENCES_HEADING = /^\s*(?:[IVXLC]+\.|\d+\.?)?\s*(?:references(?: cited)?|bibliography|works cited|literature cited|reference list)\s*$/i;

const YEAR = String.raw`(?:1[5-9]\d\d|20\d\d)`;
/** One or more years: "1981, 1984", "1990; 1992a", and letters alone after a year: "1990a, b, c". */
const YEARS = String.raw`${YEAR}[a-z]?(?:\s*[,;]\s*(?:${YEAR}[a-z]?|[a-z]\b))*`;
/** A surname: an optional particle ("van", "de"), then a capitalised word; letters, apostrophes and hyphens. */
const SURNAME = String.raw`(?:(?:van|von|de|der|den|du|la|le|di|da|del)\s+)*\p{Lu}[\p{L}'’\-]+`;
const NAMES = String.raw`${SURNAME}(?:\s+et\s+al\.?|(?:,\s*${SURNAME})*,?\s+(?:and|&)\s+${SURNAME})?`;
/** Inside brackets a company may be cited too: "(Aptech Systems Inc., 1991)". */
const BRACKET_NAMES = String.raw`(?:${NAMES}|\p{Lu}[\p{L}\-]+(?:\s+\p{Lu}[\p{L}.\-]+){1,2})`;
/** Words that may open a citation inside its brackets; they are kept when the citation becomes a number. */
const LEAD = String.raw`(?:e\.g\.,?|i\.e\.,?|see(?:,? also|,? for example|,? e\.g\.,?)?|cf\.|reviewed (?:in|by)|for (?:a )?reviews?,? see|for example,?)`;

const ITEM = new RegExp(String.raw`^(?:(${LEAD})\s+)?(${BRACKET_NAMES}),?\s*(${YEARS})$`, "u");
const ONLY_YEARS = new RegExp(String.raw`^${YEARS}$`);
/** Every start of a run of names that ends where a bracket of years begins, "Berenbaum's" too; longest first. */
const NAME_STARTS = new RegExp(String.raw`(?:^|[\s(\[“"'‘])(?=(${BRACKET_NAMES})(?:['’]s)?\s*$)`, "gu");

/** Words in an author list that are not anyone's surname. */
const NOT_SURNAME = /^(?:jr\.?|sr\.?|inc\.?|ltd\.?|et al\.?|eds?\.?|and|&)$/i;
/** Initials: "J. R.", "T.-C.", "G. E. P", "C"; not "IMSL" or "STSC", which are names. */
const isInitials = (s: string) => /^(?:\p{Lu}\.?[\s.\-]*){1,4}$/u.test(s) && (s.includes(".") || s.length <= 2);

/** Letters only, no accents, lower case; "Sühnel" and "Suehnel" are one name. */
function fold(name: string): string[] {
  const lower = name.toLowerCase().replace(/[’']/g, "'");
  const plain = lower.normalize("NFD").replace(/\p{M}/gu, "");
  const german = lower.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFD").replace(/\p{M}/gu, "");
  return plain === german ? [plain] : [plain, german];
}
const sameName = (a: string, b: string) => fold(a).some((x) => fold(b).includes(x));

type Entry = { n: number; surnames: string[]; year: string; letter: string };

/**
 * An entry's surnames, in order, and its year. Two printed forms are read: the author list ending at a colon
 * ("Ashford, J. R., and Smith, C. S.: General models … 1964.", the Pharmacological Reviews style) and the one
 * ending at a year in brackets ("Waud, D. R., & Parker, R. B. (1971). …", APA). The year is the bracketed one, or
 * else the last year printed (a journal entry ends with it). Null when neither form is there.
 */
export function readEntry(text: string): { surnames: string[]; year: string; letter: string } | null {
  const bracketed = new RegExp(String.raw`\((${YEAR})([a-z]?)\)`).exec(text);
  const colon = text.indexOf(":");
  let authors: string;
  // A year in brackets counts only where it ends the author list; "(1990)" inside a title ("… concerning Greco et
  // al. (1990), in …") is not the entry's year.
  const apa = !!bracketed && (colon < 0 || bracketed.index < colon);
  if (apa) authors = text.slice(0, bracketed.index);
  else if (colon > 0) authors = text.slice(0, colon);
  else return null;
  // A year may carry the letter that tells two works of one year apart: "Academic Press, New York, 1991b."
  const last = [...text.matchAll(new RegExp(String.raw`\b(${YEAR})([a-z]?)\b`, "g"))].at(-1);
  const year = apa ? bracketed[1] : last?.[1];
  const letter = (apa ? bracketed[2] : last?.[2]) ?? "";
  if (!year) return null;
  const surnames = authors
    .split(/,|;|\s+and\s+|\s*&\s*/)
    // "Wolf T." and "Rideout D. C.", printed without the comma: the surname is the part before the initials.
    .map((s) => s.replace(/^\s*(?:and|&)\s+/i, "").replace(/\s+(?:\p{Lu}\.[\s\-]*)+$/u, "").trim())
    .filter((s) => s && !NOT_SURNAME.test(s) && !isInitials(s));
  return surnames.length ? { surnames, year, letter } : null;
}

/** The surnames a citation names: "Waud and Parker" → two; "Greco et al." → one and "et al.". */
function citedNames(names: string): { surnames: string[]; etAl: boolean } {
  const etAl = /\s+et\s+al\.?$/.test(names);
  const list = names
    .replace(/['’]s$/, "") // "Chou and Talalay's (1984)"
    .replace(/\s+et\s+al\.?$/, "")
    .replace(/,?\s+(?:Inc|Ltd)\.?$/, "")
    .split(/,?\s+(?:and|&)\s+|,\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !NOT_SURNAME.test(s));
  return { surnames: list, etAl };
}

/**
 * The entry a citation names, or why there is none. The authors must be the entry's authors: the same names in the
 * same order, or the first name and "et al." for three or more. A year's letter ("1992b") picks among the entries
 * cited the same way that year, in printed order, as such letters are given; a year with no letter must have one
 * entry.
 */
function resolve(entries: Entry[], cited: { surnames: string[]; etAl: boolean }, yearText: string): number | "no entry" | "two entries" {
  const year = yearText.slice(0, 4);
  const letter = yearText.slice(4);
  const same = entries.filter(
    (e) =>
      e.year === year &&
      (cited.etAl
        ? e.surnames.length >= 3 && sameName(e.surnames[0], cited.surnames[0])
        : e.surnames.length === cited.surnames.length && e.surnames.every((s, i) => sameName(s, cited.surnames[i]))),
  );
  if (!letter) return same.length === 1 ? same[0].n : same.length ? "two entries" : "no entry";
  // The list prints the letter ("1991b."): that entry. Otherwise the letters go in printed order.
  if (same.some((e) => e.letter)) {
    const lettered = same.filter((e) => e.letter === letter);
    return lettered.length === 1 ? lettered[0].n : lettered.length ? "two entries" : "no entry";
  }
  return same[letter.charCodeAt(0) - 97]?.n ?? "no entry";
}

/** "[3, 7–9]": numbers in order, a run of three or more as a range. */
export function numberLabel(numbers: number[]): string {
  const list = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < list.length; ) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    parts.push(j - i >= 2 ? `${list[i]}–${list[j]}` : list.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return `[${parts.join(", ")}]`;
}

/** "1990a, b, c" → 1990a, 1990b, 1990c: a letter alone takes the year before it. */
function splitYears(years: string): string[] {
  const out: string[] = [];
  for (const y of years.split(/\s*[,;]\s*/).filter(Boolean)) out.push(/^[a-z]$/.test(y) && out.length ? out.at(-1)!.slice(0, 4) + y : y);
  return out;
}

/**
 * The citations of one paragraph. Two shapes:
 * - in brackets, "(Waud and Parker, 1971; Waud et al., 1978)": the whole bracket becomes "[n, m]";
 * - in the sentence, "Webb (1963)", "Sühnel (1990; 1992a)": only the bracket becomes "[n]", so it reads "Webb [80]".
 * A bracket with any part that is not a citation, or names a work the list does not hold once, is left as written.
 */
function citationsIn(p: CitationParagraph, entries: Entry[], unmatched: Unmatched[]): Citation[] {
  const out: Citation[] = [];
  for (const m of p.text.matchAll(/\(([^()]*)\)/g)) {
    const inner = m[1].trim();
    if (!new RegExp(String.raw`\b${YEAR}[a-z]?\b`).test(inner)) continue;
    const start = m.index!;
    const end = start + m[0].length;
    const found: number[] = [];
    let lead = "";
    let why: Unmatched["why"] | null = null;
    if (ONLY_YEARS.test(inner)) {
      // The names before the bracket, longest run first: "However, Valeriote and Lin (1975)" is tried as three
      // names, then as "Valeriote and Lin". The first run whose every year names one entry is taken.
      const runs = [...p.text.slice(Math.max(0, start - 120), start).matchAll(NAME_STARTS)].map((m) => m[1]);
      if (!runs.length) continue; // "(1995)" with no author before it: not a citation this can read
      for (const run of runs) {
        const cited = citedNames(run);
        const nums = splitYears(inner).map((y) => resolve(entries, cited, y));
        if (nums.every((n) => typeof n === "number")) {
          found.push(...(nums as number[]));
          why = null;
          break;
        }
        why ??= nums.find((n) => typeof n !== "number") as Unmatched["why"];
      }
    } else {
      const items = inner.split(/\s*;\s*/);
      const parsed = items.map((it) => ITEM.exec(it));
      if (parsed.some((x) => !x)) {
        // Words a citation does not hold ("Eq. 5, 1990 data"): not a citation. One that names authors and a year but
        // in a form not read here is counted, so the check on a real paper sees it.
        if (parsed.some(Boolean)) unmatched.push({ sectionId: p.id, at: start, text: m[0], why: "no entry" });
        continue;
      }
      if (parsed.slice(1).some((x) => x![1])) {
        unmatched.push({ sectionId: p.id, at: start, text: m[0], why: "no entry" }); // "; see also …" inside: kept as written
        continue;
      }
      lead = parsed[0]![1] ?? "";
      for (const x of parsed) {
        const cited = citedNames(x![2]);
        for (const y of splitYears(x![3])) {
          const n = resolve(entries, cited, y);
          if (typeof n === "number") found.push(n);
          else why ??= n;
        }
      }
    }
    if (why || !found.length) {
      unmatched.push({ sectionId: p.id, at: start, text: m[0], why: why ?? "no entry" });
      continue;
    }
    const numbers = [...new Set(found)].sort((a, b) => a - b);
    out.push({
      sectionId: p.id,
      cfi: p.cfi,
      chapterIndex: p.chapterIndex,
      start,
      end,
      numbers,
      label: lead ? `(${lead} ${numberLabel(numbers)})` : numberLabel(numbers),
    });
  }
  return out;
}

/**
 * A paper's reference list and citations, from its paragraphs in reading order. The list is the paragraphs after the
 * last reference heading (a chapter so labelled, or a paragraph that says only "References"), to the end of that
 * chapter; an entry is a paragraph whose authors and year can be read. Citations are found in the prose before it.
 */
export function findCitations(paragraphs: CitationParagraph[], chapters: ChapterLabel[] = []): PaperCitations {
  const refChapters = new Set(chapters.filter((c) => REFERENCES_HEADING.test(c.label)).map((c) => c.chapterIndex));
  let headingAt = -1;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    if (REFERENCES_HEADING.test(paragraphs[i].text)) {
      headingAt = i;
      break;
    }
  }
  let listFrom: number;
  let listChapter: number;
  if (headingAt >= 0) {
    listFrom = headingAt + 1;
    listChapter = paragraphs[headingAt].chapterIndex;
  } else {
    listFrom = paragraphs.findIndex((p) => refChapters.has(p.chapterIndex));
    if (listFrom < 0) return NONE;
    listChapter = paragraphs[listFrom].chapterIndex;
  }
  const references: Reference[] = [];
  const entries: Entry[] = [];
  for (let i = listFrom; i < paragraphs.length && paragraphs[i].chapterIndex === listChapter; i++) {
    const p = paragraphs[i];
    // Every entry is numbered (one with a year), read or not, so the numbers count down the printed list.
    if (!new RegExp(String.raw`\b${YEAR}`).test(p.text)) continue;
    const n = references.length + 1;
    references.push({ n, sectionId: p.id, cfi: p.cfi, chapterIndex: p.chapterIndex, text: p.text });
    const read = readEntry(p.text);
    if (read) entries.push({ n, ...read });
  }
  if (!references.length) return NONE;
  const listStart = headingAt >= 0 ? headingAt : listFrom;
  const unmatched: Unmatched[] = [];
  const citations = paragraphs
    .slice(0, listStart)
    .filter((p) => (p.form ?? "prose") === "prose")
    .flatMap((p) => citationsIn(p, entries, unmatched));
  return { references, citations, unmatched };
}

/**
 * A book's citations for the reader, worked out from its stored paragraphs. Cheap for a book with no reference
 * list: its chapter labels, and the short paragraphs that say only "References", are read before giving up.
 */
export async function citationsFor(db: Db, ownerId: string, bookId: string): Promise<PaperCitations> {
  const [book] = await db.select({ id: books.id }).from(books).where(isOwnBook(bookId, ownerId));
  if (!book) return NONE;
  const chapters = await db
    .select({ chapterIndex: sections.chapterIndex, label: sections.label, href: sections.href })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "chapter")));
  if (!chapters.some((c) => REFERENCES_HEADING.test(c.label))) {
    const headings = await db
      .select({ text: sections.text })
      .from(sections)
      .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph"), sql`length(${sections.text}) < 40`));
    if (!headings.some((h) => REFERENCES_HEADING.test(h.text))) return NONE;
  }
  const paragraphs = await db
    .select({ id: sections.id, cfi: sections.cfi, chapterIndex: sections.chapterIndex, position: sections.position, text: sections.text, form: sections.form })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph")))
    .orderBy(asc(sections.position));
  return findCitations(paragraphs, chapters);
}

/**
 * What the reader needs (app/(reader)/books/[id]/read/citations.ts): each citation's paragraph, offsets and number,
 * with the entries it names as its tooltip; each entry's paragraph and number; how many stay as written. Null for a
 * book with no citation found.
 */
export function forReader(pc: PaperCitations) {
  if (!pc.citations.length) return null;
  const text = new Map(pc.references.map((r) => [r.n, r.text.length > 300 ? `${r.text.slice(0, 299)}…` : r.text]));
  return {
    cites: pc.citations.map((c) => ({
      cfi: c.cfi,
      chapterIndex: c.chapterIndex,
      start: c.start,
      end: c.end,
      label: c.label,
      title: c.numbers.map((n) => `${n}. ${text.get(n)}`).join("\n"),
    })),
    refs: pc.references.map((r) => ({ cfi: r.cfi, chapterIndex: r.chapterIndex, n: r.n })),
    unmatched: pc.unmatched.length,
  };
}
