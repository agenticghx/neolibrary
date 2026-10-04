import type { Package } from "./package";

/**
 * M13 (b): match a read-along package's timed words to the book's own
 * paragraphs (the app's `sections`), so the existing player can highlight
 * them.
 *
 * The package's script is what was read aloud; the paragraphs are the book
 * as the app split it. They differ: spoken headings that are not printed,
 * page footers and footnotes that were not read, paragraphs the narrator
 * skipped, words broken across a PDF line ("normal- scientific"). So both
 * are reduced to plain lower-case words and walked side by side; where they
 * stop agreeing, the walk jumps to the nearest place where RESYNC words in
 * a row agree again on both sides. Words in between get no time.
 */
export type Paragraph = { id: string; text: string; chapterIndex: number; position: number };

/** [startMs, endMs, from, to]: `from`/`to` are offsets into the paragraph's text (JavaScript string units). */
export type TimedWord = [number, number, number, number];

export type ParagraphTiming = {
  sectionId: string;
  /** The package audio file these times are in. */
  audio: string;
  /** Times are milliseconds from the start of that audio file. */
  words: TimedWord[];
  startMs: number;
  endMs: number;
  /** Share of the paragraph's words that got a time. */
  coverage: number;
};

export type MatchReport = {
  paragraphs: ParagraphTiming[];
  chapters: { n: number; title: string; spokenWords: number; matchedWords: number }[];
};

const RESYNC = 4; // words in a row that must agree to pick up the walk again
const LOOKAHEAD = 1500; // how far ahead (in words, either side) to look for that

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");

type BookToken = { key: string; para: number; from: number; to: number };
type SpokenToken = { key: string; startMs: number; endMs: number; audio: string };

function bookTokens(paragraphs: Paragraph[]): BookToken[] {
  const out: BookToken[] = [];
  paragraphs.forEach((p, para) => {
    const words = [...p.text.matchAll(/\S+/g)];
    for (let i = 0; i < words.length; i++) {
      const m = words[i];
      let key = norm(m[0]);
      let to = m.index! + m[0].length;
      // A word broken across a line in a PDF: "normal-" + "scientific".
      if (/[A-Za-z]-$/.test(m[0]) && i + 1 < words.length && /^[a-z]/.test(words[i + 1][0])) {
        key += norm(words[i + 1][0]);
        to = words[i + 1].index! + words[i + 1][0].length;
        i++;
      }
      if (key) out.push({ key, para, from: m.index!, to });
    }
  });
  return out;
}

/** Finds the nearest (i, j) with RESYNC equal keys from a[i] and b[j], i and j within LOOKAHEAD. */
function resync(a: string[], ai: number, b: string[], bj: number, bookAhead = LOOKAHEAD): [number, number] | null {
  const gram = (x: string[], k: number) => x.slice(k, k + RESYNC).join(" ");
  const seen = new Map<string, number>();
  for (let j = bj; j < Math.min(b.length - RESYNC + 1, bj + bookAhead); j++) {
    const g = gram(b, j);
    if (!seen.has(g)) seen.set(g, j);
  }
  let best: [number, number] | null = null;
  for (let i = ai; i < Math.min(a.length - RESYNC + 1, ai + LOOKAHEAD); i++) {
    if (best && i - ai >= best[0] - ai + best[1] - bj) break; // cannot get nearer
    const j = seen.get(gram(a, i));
    if (j !== undefined && (!best || i - ai + j - bj < best[0] - ai + best[1] - bj)) best = [i, j];
  }
  return best;
}

export function matchToParagraphs(pkg: Package, paragraphs: Paragraph[]): MatchReport {
  const ordered = [...paragraphs].sort((x, y) => x.position - y.position);
  const book = bookTokens(ordered);
  const bookKeys = book.map((t) => t.key);
  const timed = new Map<number, { audio: string; words: TimedWord[] }>(); // by paragraph index
  const chapters: MatchReport["chapters"] = [];

  let bj = 0; // position in the book's words
  for (const c of pkg.chapters) {
    const spoken: SpokenToken[] = c.words
      .filter((w) => w.source === "aligned" && w.start !== null && w.end !== null)
      .map((w) => ({ key: norm(w.w), startMs: Math.round(w.start! * 1000), endMs: Math.round(w.end! * 1000), audio: c.audio }))
      .filter((t) => t.key);
    const keys = spoken.map((t) => t.key);
    let ai = 0;
    let matched = 0;
    // Where this chapter starts in the book. The book map says which EPUB
    // chapter (spine index) or PDF page its first printed paragraph is on;
    // start looking there, so a passage quoted earlier in the book (Mary
    // Shelley's introduction quotes chapter V) is not taken for it. Then
    // search the whole rest of the book (front matter can be long).
    const script = c.script.split("/").pop();
    const anchor = pkg.bookMap.find((m) => m.script === script && m.found);
    const target = anchor ? (anchor.chapter ?? (anchor.page !== null ? anchor.page - 1 : null)) : null;
    if (target !== null) {
      const at = book.findIndex((t, k) => k >= bj && ordered[t.para].chapterIndex >= target);
      if (at >= 0) bj = at;
    }
    const first = resync(keys, 0, bookKeys, bj, bookKeys.length);
    if (first) [ai, bj] = first;
    while (ai < keys.length && bj < bookKeys.length) {
      if (keys[ai] === bookKeys[bj]) {
        const b = book[bj];
        const s = spoken[ai];
        const entry = timed.get(b.para) ?? { audio: s.audio, words: [] };
        if (entry.audio === s.audio) entry.words.push([s.startMs, s.endMs, b.from, b.to]);
        timed.set(b.para, entry);
        matched++;
        ai++;
        bj++;
        continue;
      }
      const next = resync(keys, ai, bookKeys, bj);
      if (!next) break; // nothing more of this chapter is in the book from here
      [ai, bj] = next;
    }
    chapters.push({ n: c.n, title: c.title, spokenWords: spoken.length, matchedWords: matched });
  }

  const counts = new Map<number, number>();
  for (const b of book) counts.set(b.para, (counts.get(b.para) ?? 0) + 1);
  const out: ParagraphTiming[] = [];
  for (const [para, t] of [...timed.entries()].sort((x, y) => x[0] - y[0])) {
    const p = ordered[para];
    const total = counts.get(para) ?? 0;
    out.push({
      sectionId: p.id,
      audio: t.audio,
      words: t.words,
      startMs: t.words[0][0],
      endMs: t.words[t.words.length - 1][1],
      coverage: Math.round((t.words.length / Math.max(total, 1)) * 1000) / 1000,
    });
  }
  return { paragraphs: out, chapters };
}
