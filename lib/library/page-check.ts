/**
 * The page check (M25, docs/scan-to-text-plan.md): each page Claude read is
 * compared, word by word, with the scan's own hidden text (the OCR text that
 * came inside the PDF). Two readings that agree are unlikely to share a
 * mistake; a page where they disagree is listed for the owner to look at.
 * The hidden text is often the wrong one (a sideways table, blank pages whose
 * show-through was read as letters), and that is worth a look too.
 */

/**
 * Below this share of matching words, a page is listed for a look. Measured on
 * five pages of The Pay Off (2026-10-15): ordinary pages agreed 0.98 to 1 once
 * the running head and page number were left out, so one reworded sentence
 * (about 5% of a page's words) falls below it; the contents page and a
 * sideways table fall well below.
 */
export const AGREEMENT_FLOOR = 0.95;
/** With fewer words than this in the hidden text there is nothing to compare against. */
export const MIN_WORDS = 20;

const PLAIN: Record<string, string> = { "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-", "\u00a0": " " };

/**
 * The scan's hidden text without its page furniture: the running head (a short
 * first line with no full stop) and the page number (a line that is only a
 * number, in figures or roman numerals), which a flowing text leaves out.
 */
export function withoutFurniture(hiddenText: string) {
  const lines = hiddenText.split("\n").map((l) => l.trim()).filter(Boolean);
  const folio = /^([0-9]{1,4}|[ivxlcdm]{1,7})$/i;
  while (lines.length && folio.test(lines[lines.length - 1])) lines.pop();
  while (lines.length && folio.test(lines[0])) lines.shift();
  if (lines.length > 1 && lines[0].split(/\s+/).length <= 10 && !/[.!?:'"\u2019\u201d]$/.test(lines[0])) lines.shift();
  return lines.join("\n");
}

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

/**
 * How far the two readings agree, from 0 to 1 (1: the same words), or null
 * when the hidden text is too short to compare. A page is flagged when they
 * agree less than AGREEMENT_FLOOR, or when Claude found words on a page whose
 * hidden text has almost none (a picture, or a page the scan's OCR missed).
 */
export function checkPage(transcription: string, hiddenText: string) {
  const ours = pageWords(transcription);
  const theirs = pageWords(withoutFurniture(hiddenText));
  if (theirs.length < MIN_WORDS) return { agreement: null, flagged: ours.length >= MIN_WORDS };
  const agreement = Math.max(0, 1 - wordEdits(ours, theirs) / Math.max(ours.length, theirs.length));
  return { agreement: Math.round(agreement * 1000) / 1000, flagged: agreement < AGREEMENT_FLOOR };
}
