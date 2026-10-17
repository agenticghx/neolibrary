/**
 * The page check (M25, docs/scan-to-text-plan.md): each page Claude read is
 * compared, word by word, with the scan's own hidden text (the OCR text that
 * came inside the PDF). Two readings that agree are unlikely to share a
 * mistake; a page where they disagree is listed for the owner to look at.
 * The hidden text is often the wrong one (a sideways table, blank pages whose
 * show-through was read as letters), and that is worth a look too.
 */

/**
 * Below this share of Claude's words found in the scan's hidden text, a page
 * is listed for a look. Words are matched letter by letter (see `confirmed`),
 * so the hidden text's own faults (words run together, line-end hyphens left
 * in, a stray letter) do not count against a page.
 */
export const AGREEMENT_FLOOR = 0.9;
/**
 * A run of this many words in a row in Claude's reading that the hidden text
 * does not have: words reworded or made up. And of this many in the hidden
 * text that Claude left out. Measured on The Pay Off's 360 pages (2026-10-17):
 * six words reworded in a paragraph were caught on 275 of 275 pages, eight
 * words dropped on 252 of 275; ordinary pages had runs of at most 3 and 5.
 */
export const ADDED_RUN = 4;
export const DROPPED_RUN = 6;
/** With fewer words than this in the hidden text there is nothing to compare against. */
export const MIN_WORDS = 20;

const PLAIN: Record<string, string> = { "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-", "\u00a0": " " };

/**
 * The scan's hidden text without its page furniture: the running head (a short
 * first line with no full stop) and the page number (a line that is only a
 * number, in figures or roman numerals), which a flowing text leaves out.
 */
export function withoutFurniture(hiddenText: string) {
  const lines = withoutFolio(hiddenText);
  if (lines.length > 1 && lines[0].split(/\s+/).length <= 10 && !/[.!?:'"\u2019\u201d]$/.test(lines[0])) lines.shift();
  return lines.join("\n");
}

/** The hidden text's lines without a page number at the top or bottom. */
function withoutFolio(hiddenText: string) {
  const lines = hiddenText.split("\n").map((l) => l.trim()).filter(Boolean);
  const folio = /^([0-9]{1,4}|[ivxlcdm]{1,7})$/i;
  while (lines.length && folio.test(lines[lines.length - 1])) lines.pop();
  while (lines.length && folio.test(lines[0])) lines.shift();
  return lines;
}

/**
 * An answer that is not the page: Claude saying it will not copy it, or
 * offering a summary. It happened once in The Pay Off's 360 pages (page 213,
 * 2026-10-17: "I can't transcribe this page word for word ... Here is a
 * summary instead.").
 */
export const DECLINED = /^\s*(I can['\u2019]?t|I cannot|I['\u2019]m (not able|unable)|I am (not able|unable)|Sorry|I won['\u2019]?t)\b|here is a summary/i;

/** The words of a text, tidied the same way for both readings (the 5-page test's scorer, tools/score.py). */
export function pageWords(text: string): string[] {
  const t = text
    .replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u00a0]/g, (c) => PLAIN[c])
    .replace(/(\w)-[ \t]*\n\s*(\w)/g, "$1$2") // a word broken at a line end
    .replace(/\[\^\d+\]:?/g, " ") // footnote markers
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>|`]/g, " ") // Markdown marks
    .replace(/\[Figure:[^\]]*\]/g, " ");
  return (t.match(/[A-Za-z0-9][A-Za-z0-9'.,;:!?%$()-]*/g) ?? [])
    .map((w) => w.replace(/^["'(]+|["'()]+$/g, "").replace(/[.,;:!?]+$/, ""))
    .filter(Boolean);
}

/** The fewest word changes (replace, drop or add) that turn `a` into `b`. */
export function wordEdits(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), prev[j] + 1, cur[j - 1] + 1));
    prev = cur;
  }
  return prev[b.length];
}

const letters = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * For each word of `words`, whether it is found in `other`: both are lined up
 * letter by letter (the fewest changes turning one string of letters into the
 * other, spaces and punctuation left out), and a word counts as found when its
 * letters line up with the same letters there (one may differ in a word of six
 * or more). Lining up letters, not words, lets "Tounderstandhowto" in the
 * hidden text confirm "To understand how to", and "vil- lage" confirm "village".
 */
export function confirmed(words: string[], other: string[]): boolean[] {
  const ws = words.map(letters);
  const a = ws.join("");
  const b = other.map(letters).join("");
  const owner: number[] = [];
  ws.forEach((w, i) => {
    for (let k = 0; k < w.length; k++) owner.push(i);
  });
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const d = n < 65535 && m < 65535 ? new Uint16Array((n + 1) * width) : new Uint32Array((n + 1) * width);
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++) {
    const row = i * width;
    const up = row - width;
    d[row] = i;
    for (let j = 1; j <= m; j++) d[row + j] = Math.min(d[up + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), d[up + j] + 1, d[row + j - 1] + 1);
  }
  const same = new Array<number>(ws.length).fill(0);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const here = d[i * width + j];
    if (a[i - 1] === b[j - 1] && here === d[(i - 1) * width + j - 1]) {
      same[owner[i - 1]]++;
      i--;
      j--;
    } else if (here === d[(i - 1) * width + j - 1] + 1) {
      i--;
      j--;
    } else if (here === d[(i - 1) * width + j] + 1) i--;
    else j--;
  }
  return ws.map((w, i) => same[i] >= w.length - (w.length >= 6 ? 1 : 0));
}

/** The longest run of words in a row not found. */
const longestRun = (found: boolean[]) => found.reduce((acc, f) => ({ run: f ? 0 : acc.run + 1, best: Math.max(acc.best, f ? 0 : acc.run + 1) }), { run: 0, best: 0 }).best;

/**
 * How far Claude's reading of a page agrees with the scan's hidden text: the
 * share of Claude's words found there, from 0 to 1, or null when the hidden
 * text is too short to compare. A page is flagged for a look when:
 * - Claude declined and wrote something else (`DECLINED`);
 * - fewer than AGREEMENT_FLOOR of its words are found (the contents page, a
 *   sideways table the scan's OCR read as gibberish);
 * - ADDED_RUN words in a row are not found: reworded or made up;
 * - DROPPED_RUN words in a row of the hidden text are missing from Claude's
 *   reading: left out (or a figure's labels, which a reading gives as a caption);
 * - Claude found words on a page whose hidden text has almost none.
 * The hidden text's first line, when short, is left out of the left-out check
 * (a running head Claude rightly leaves out), but not of the others (a
 * chapter's title).
 */
export function checkPage(transcription: string, hiddenText: string) {
  const ours = pageWords(transcription);
  const lines = withoutFolio(hiddenText);
  const theirs = pageWords(lines.join("\n"));
  const declined = DECLINED.test(transcription.slice(0, 200));
  if (pageWords(withoutFurniture(hiddenText)).length < MIN_WORDS) return { agreement: null, flagged: declined || ours.length >= MIN_WORDS };
  const found = confirmed(ours, theirs);
  const agreement = Math.round((found.filter(Boolean).length / Math.max(1, found.length)) * 1000) / 1000;
  const head = lines.length > 1 && lines[0].split(/\s+/).length <= 15 ? 1 : 0; // a running head, never a paragraph
  const kept = confirmed(pageWords(lines.slice(head).join("\n")), ours);
  const flagged = declined || agreement < AGREEMENT_FLOOR || longestRun(found) >= ADDED_RUN || longestRun(kept) >= DROPPED_RUN;
  return { agreement, flagged };
}
