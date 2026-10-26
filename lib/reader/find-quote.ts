/**
 * Finding a note's quoted words again in another version of the same book
 * (Open unknowns row 23 (1), decided by Samuel 2026-10-26: notes cross between
 * a scan and its text edition). The two versions were read by different hands
 * (the Internet Archive's OCR, and Claude reading the page pictures), so their
 * spaces, punctuation, hyphens and capitals differ, and a word can be
 * misspelt in one: words are compared by their letters and digits alone, and
 * a quote not found whole is found by its first and last letters.
 */

/** The letters and digits of a text, lower case: what two readings of a page share. */
export const lettersOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** A quote shorter than this (in letters) is found only whole: its ends alone would match too much. */
const ENDS = 16;

/**
 * Where `quote` is in `text` (both already `lettersOf`): its start and end in
 * `text`, or null. Several places: the one whose letters before it end like
 * `prefix`'s. Not found whole (a word read differently): where its first
 * ENDS letters are followed, within a third more of its length, by its last
 * ENDS letters; else where either end alone is, the quote's length from it.
 */
export function findLetters(text: string, quote: string, prefix = ""): [number, number] | null {
  if (!quote) return null;
  const at: number[] = [];
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) at.push(i);
  if (at.length) {
    const before = prefix.slice(-ENDS);
    const best = (before ? at.find((i) => text.slice(0, i).endsWith(before)) : undefined) ?? at[0];
    return [best, best + quote.length];
  }
  if (quote.length < ENDS * 2) return null;
  const head = quote.slice(0, ENDS);
  const tail = quote.slice(-ENDS);
  for (let i = text.indexOf(head); i >= 0; i = text.indexOf(head, i + 1)) {
    const j = text.indexOf(tail, i + ENDS);
    if (j >= 0 && j + ENDS - i <= quote.length * 1.34 && j + ENDS - i >= quote.length * 0.66) return [i, j + ENDS];
  }
  const i = text.indexOf(head);
  if (i >= 0) return [i, Math.min(i + quote.length, text.length)];
  const j = text.indexOf(tail);
  if (j >= 0) return [Math.max(j + ENDS - quote.length, 0), j + ENDS];
  return null;
}

/** A page break in a text edition (text-epub.ts pageMark): its page number. */
const pageOfMark = (el: Element) => (el.getAttribute("role") === "doc-pagebreak" ? Number(/^page-(\d+)$/.exec(el.id)?.[1] ?? NaN) : NaN);

/**
 * The quote's place in a document: in a text edition's chapter, between the
 * break of page `page` and the next break (a quote at the foot of a page that
 * runs on goes on past it); in a scan's page, anywhere in `root`. Returns the
 * text positions of its first and last letters (end exclusive), or null.
 */
export function positionsForQuote(
  root: Element,
  quote: { exact: string; prefix?: string },
  page?: number,
): { start: [Node, number]; end: [Node, number] } | null {
  const want = lettersOf(quote.exact);
  if (!want) return null;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 1 | 4 /* NodeFilter.SHOW_ELEMENT | SHOW_TEXT */);
  const letters: string[] = [];
  const where: [Node, number][] = [];
  // Before the page's break, on the page, past its end (letters kept for a quote that runs on), done.
  let state: "before" | "on" | "past" | "done" = page === undefined ? "on" : "before";
  let left = 0;
  for (let node = walker.nextNode(); node && state !== "done"; node = walker.nextNode()) {
    if (node.nodeType === 1) {
      const n = pageOfMark(node as Element);
      if (Number.isNaN(n)) continue;
      if (state === "before" && n === page) state = "on";
      else if (state === "on" && page !== undefined && n !== page) {
        state = "past";
        left = want.length;
      }
      continue;
    }
    if (state === "before") continue;
    const text = node.nodeValue ?? "";
    for (let i = 0; i < text.length && state !== "done"; i++) {
      for (const c of lettersOf(text[i])) {
        letters.push(c);
        where.push([node, i]);
      }
      if (state === "past" && lettersOf(text[i]) && --left <= 0) state = "done";
    }
  }
  const found = findLetters(letters.join(""), want, lettersOf(quote.prefix ?? ""));
  if (!found) return null;
  const [s, e] = found;
  const [endNode, endAt] = where[e - 1];
  return { start: where[s], end: [endNode, endAt + 1] };
}

/** positionsForQuote as a Range, or null. */
export function rangeForQuote(root: Element, quote: { exact: string; prefix?: string }, page?: number): Range | null {
  const at = positionsForQuote(root, quote, page);
  if (!at) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(at.start[0], at.start[1]);
  range.setEnd(at.end[0], at.end[1]);
  return range;
}
