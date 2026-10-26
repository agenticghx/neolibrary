/**
 * Listen on a scan that has a text edition (Open unknowns row 24, decided by
 * Samuel 2026-10-26: "fix now"). A scan's paragraphs (its sections) are the
 * Internet Archive's hidden OCR text, which can be nonsense: a sideways table
 * read as gibberish (The Pay Off p. 51), or letters seen through a blank page
 * from the other side (p. 32). Once a page has been read for the text
 * edition, Listen on the scan reads that reading instead, a whole page at a
 * time; a page the reading found blank is passed over; a page not read keeps
 * the OCR text. The sections themselves stay as they are: the page check
 * compares the reading with them (hiddenTextOf).
 *
 * The reader lights each spoken word in the page's text layer, which holds
 * the OCR text, by counting non-space characters (M13 (e)). The reading's
 * words are lined up with the OCR words (placeWords); a word with no match
 * is lit nowhere (null), never at a wrong place.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, generations, textEditionJobs } from "@/lib/db/schema";
import { pageSectionId, TRANSCRIBE_KIND } from "./text-edition";
import { pageSpeech } from "./text-epub";

/** A scan's pages as Listen reads them: read for the edition, or found blank. Pages are counted from 1. */
export type ScanSpeech = { read: Set<number>; blank: Set<number>; ownerId: string };

/** How Listen reads this book's pages, or null when it reads its own sections (an EPUB, a scan with no edition, a PDF's own text laid out again). */
export async function scanSpeechOf(db: Db, bookId: string): Promise<ScanSpeech | null> {
  const [book] = await db.select({ ownerId: books.ownerId, fileType: books.fileType }).from(books).where(eq(books.id, bookId));
  if (book?.fileType !== "pdf") return null;
  const [edition] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.ownerId, book.ownerId), eq(books.editionOf, bookId)));
  if (!edition) return null;
  const rows = await db
    .select({ sectionId: generations.sectionId })
    .from(generations)
    .where(and(eq(generations.ownerId, book.ownerId), eq(generations.bookId, bookId), eq(generations.kind, TRANSCRIBE_KIND)));
  const read = new Set(rows.map((r) => Number(/^page-(\d+)$/.exec(r.sectionId ?? "")?.[1])).filter(Number.isFinite));
  if (!read.size) return null;
  const jobs = await db
    .select({ blank: textEditionJobs.blankPages })
    .from(textEditionJobs)
    .where(and(eq(textEditionJobs.ownerId, book.ownerId), eq(textEditionJobs.bookId, bookId)));
  const blank = new Set(jobs.flatMap((j) => j.blank).filter((p) => !read.has(p)));
  return { read, blank, ownerId: book.ownerId };
}

/** The newest reading of each of `pages` as text to speak, as the edition takes it (the newest reading wins). */
export async function pageReadings(db: Db, speech: ScanSpeech, bookId: string, pages: number[]): Promise<Map<number, string>> {
  const wanted = pages.filter((p) => speech.read.has(p));
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ sectionId: generations.sectionId, output: generations.output })
    .from(generations)
    .where(
      and(
        eq(generations.ownerId, speech.ownerId),
        eq(generations.bookId, bookId),
        eq(generations.kind, TRANSCRIBE_KIND),
        inArray(generations.sectionId, wanted.map(pageSectionId)),
      ),
    )
    .orderBy(asc(generations.createdAt), asc(generations.id));
  const out = new Map<number, string>();
  for (const r of rows) out.set(Number(/^page-(\d+)$/.exec(r.sectionId ?? "")?.[1]), pageSpeech(r.output)); // later rows replace earlier ones
  return out;
}

type Word = { from: number; to: number; key: string };

/** The words of a text (runs of non-space), with their offsets in `units` (string positions, or non-space counts). */
function wordsOf(text: string, units: "chars" | "nonspace"): Word[] {
  const out: Word[] = [];
  let nonSpace = 0;
  for (const m of text.matchAll(/\S+/g)) {
    const from = units === "chars" ? (m.index ?? 0) : nonSpace;
    out.push({ from, to: from + m[0].length, key: m[0].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") });
    nonSpace += m[0].length;
  }
  return out;
}

/** Above this many word pairs (a page of thousands of words), nothing is lined up: no word is lit rather than a slow request. */
const MOST_PAIRS = 6_000_000;

/**
 * Where each of the reading's words is on the page (`spoken`, the text read
 * aloud), as non-space characters counted from the top of the page's OCR
 * text (`ocr`, its paragraphs in order): the longest run of words the two
 * share, in order, matched up (ignoring case and punctuation); a stretch
 * between two matches with as many words on each side is matched word for
 * word (an OCR misspelling: "tbe" for "the"). Returns a function from a
 * stretch of `spoken` [from, to) to its place on the page, or null.
 */
export function placeWords(spoken: string, ocr: string[]): (from: number, to: number) => [number, number] | null {
  const a = wordsOf(spoken, "chars");
  // Every paragraph's non-space characters count on from the last's (audio.ts pageOffsets): spaces never count.
  const b = wordsOf(ocr.join(" "), "nonspace");
  const n = a.length;
  const m = b.length;
  const placed: ([number, number] | null)[] = new Array(n).fill(null);
  if (n && m && n * m <= MOST_PAIRS) {
    // Longest common subsequence of the words' keys, built from the end so it is read forwards.
    const w = m + 1;
    const len = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        len[i * w + j] = a[i].key && a[i].key === b[j].key ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    const pairs: [number, number][] = [];
    for (let i = 0, j = 0; i < n && j < m; ) {
      if (a[i].key && a[i].key === b[j].key) {
        pairs.push([i, j]);
        i++;
        j++;
      } else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
      else j++;
    }
    for (const [i, j] of pairs) placed[i] = [b[j].from, b[j].to];
    // The stretches between matches (and before the first, after the last) with as many words on each side.
    const bounds: [number, number][] = [[-1, -1], ...pairs, [n, m]];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const [i0, j0] = bounds[k];
      const [i1, j1] = bounds[k + 1];
      if (i1 - i0 > 1 && i1 - i0 === j1 - j0) for (let d = 1; d < i1 - i0; d++) placed[i0 + d] = [b[j0 + d].from, b[j0 + d].to];
    }
  }
  return (from, to) => {
    // The word the stretch starts in (the timings' words are the text's runs of non-space).
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (a[mid].from <= from) lo = mid;
      else hi = mid - 1;
    }
    const word = a[lo];
    return word && word.from <= from && from < word.to && to > from ? placed[lo] : null;
  };
}
