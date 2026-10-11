/**
 * The command palette's fuzzy matcher (M21). Written for the next Claude session.
 *
 * "Fuzzy" means the letters you type need not be next to each other: "tmach" finds "The Time Machine".
 * The letters must appear in order (a *subsequence*), and a match scores higher when they start words
 * ("t" of Time, "m" of Machine), run together ("mach"), or start the text. A match whose letters are
 * scattered through the middle of words scores below zero and is dropped, so long note texts do not
 * match every short query by accident.
 */

const BASE = 1;
const TEXT_START = 10;
const WORD_START = 8;
const CONSECUTIVE = 8;
/** Per letter, when everything typed appears together in the text ("mach" in "Machine"). */
const TOGETHER = 4;
/** A run of matched letters that starts mid-word: "rnk" in Frankenstein, not "fr" at its start. */
const MID_WORD_RUN = -4;
const GAP = 0.05;
const LEAD = 0.02;
/** Longer texts compare slightly worse, so "Time" beats "The Time Machine" for "time". */
const LENGTH = 0.01;
/** Notes are long: only their first part is matched. */
const MAX_TEXT = 200;
/** Below this score per typed letter, a match is too scattered to show. */
const MIN_PER_LETTER = 2;

/** Lower case, accents removed ("É" → "e"), so "eloise" finds "Éloïse". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * How well `query` matches `text`: a number (higher is better), or null when it does not match.
 * Spaces in the query are ignored for the letter-by-letter match ("time mach" = "timemach").
 * An empty query matches nothing (the palette shows its own list then).
 */
export function score(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, "");
  if (!q) return null;
  const t = fold(text).slice(0, MAX_TEXT);
  const n = q.length;
  const m = t.length;
  if (n > m) return null;

  // What each letter of the text is worth if a query letter lands on it.
  const bonus = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    if (j === 0) bonus[j] = TEXT_START;
    else if (!isWordChar(t[j - 1]) && isWordChar(t[j])) bonus[j] = WORD_START;
    else bonus[j] = 0;
  }

  // best[j]: the best score with the current query letter matched at text position j (-Infinity: impossible).
  // A table, one query letter at a time: O(query × text), fast enough for a few hundred items per keystroke.
  let prev = new Float64Array(m).fill(-Infinity);
  for (let j = 0; j < m; j++) {
    if (t[j] !== q[0]) continue;
    prev[j] = BASE + bonus[j] - LEAD * j + (bonus[j] === 0 ? MID_WORD_RUN : 0);
  }
  for (let i = 1; i < n; i++) {
    const cur = new Float64Array(m).fill(-Infinity);
    // runMax: the best prev[k] + GAP * k over k < j - 1 (a gap before j), so a gap of g letters costs GAP * g.
    let runMax = -Infinity;
    for (let j = i; j < m; j++) {
      if (j - 2 >= 0 && prev[j - 2] > -Infinity) runMax = Math.max(runMax, prev[j - 2] + GAP * (j - 2));
      if (t[j] !== q[i]) continue;
      const together = prev[j - 1] + CONSECUTIVE;
      const apart = runMax - GAP * (j - 1) + (bonus[j] === 0 ? MID_WORD_RUN : 0);
      const best = Math.max(together, apart);
      if (best > -Infinity) cur[j] = best + BASE + bonus[j];
    }
    prev = cur;
  }
  let top = -Infinity;
  for (let j = 0; j < m; j++) top = Math.max(top, prev[j]);
  if (top === -Infinity || top < MIN_PER_LETTER * n) return null;
  const typed = fold(query).trim().replace(/\s+/g, " ");
  const together = t.includes(q) || t.includes(typed) ? TOGETHER * n : 0;
  return top + together - LENGTH * m;
}

/**
 * The best of several fields, each with a weight: a book's title counts fully and its author at half,
 * so a title that matches ranks above a book whose author matches as well.
 */
export function scoreFields(query: string, fields: [text: string, weight: number][]): number | null {
  let best: number | null = null;
  for (const [text, weight] of fields) {
    if (!text) continue;
    const s = score(query, text);
    if (s !== null && (best === null || s * weight > best)) best = s * weight;
  }
  return best;
}

/** Sorts by score, best first; equal scores keep their given order (a stable sort). */
export function rank<T>(items: T[], scoreOf: (item: T) => number | null): T[] {
  return items
    .map((item, i) => ({ item, i, s: scoreOf(item) }))
    .filter((x): x is { item: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
