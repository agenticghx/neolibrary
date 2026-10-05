/**
 * Word positions in a paragraph's text, mapped back onto the page (M7).
 * The section model stores each paragraph's text with whitespace collapsed
 * and trimmed (`textContent`, then /\s+/ to one space). This walks the
 * element's text nodes the same way, so character offsets into that text
 * become a DOM Range for the word being spoken.
 */
export function rangeForOffsets(el: Element, from: number, to: number): Range | null {
  const at = positionsForOffsets(el, from, to);
  if (!at) return null;
  const range = el.ownerDocument.createRange();
  range.setStart(at.start[0], at.start[1]);
  range.setEnd(at.end[0], at.end[1]);
  return range;
}

/** The text node and offset where a word starts, and where it ends (exclusive). */
export function positionsForOffsets(el: Element, from: number, to: number): { start: [Node, number]; end: [Node, number] } | null {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  let index = 0; // position in the collapsed text
  let started = false; // past the leading whitespace
  let pendingSpace = false;
  let start: [Node, number] | null = null;
  let end: [Node, number] | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) {
        if (started) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        index += 1; // the single space that a run of whitespace became
        pendingSpace = false;
      }
      started = true;
      if (index === from && !start) start = [node, i];
      if (index === to - 1) end = [node, i + 1];
      index += 1;
      if (end) break;
    }
    if (end) break;
  }
  return start && end ? { start, end } : null;
}

/** Not a space, as both sides count: the server placing words (lib/library/audio.ts) and the reader finding them. */
const isSpace = (unit: string) => /\s/.test(unit);

/**
 * How many non-space string units come before each position of a text (one
 * more entry than the text is long). Counted in JavaScript string units, one
 * by one, exactly as positionsForNonSpace walks a text layer.
 */
export function nonSpaceBefore(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) out.push(out[i] + (isSpace(text[i]) ? 0 : 1));
  return out;
}

/**
 * M13 (e): a word on a PDF page, found by counting non-space characters from
 * the top of the page's text layer (pdf.js draws one span per piece of text,
 * positioned by percentages, and the server joined the same pieces with
 * spaces in other places), so spaces never have to line up. `from`/`to`
 * count non-space characters, end exclusive.
 */
export function rangeForNonSpace(layer: Element, from: number, to: number): Range | null {
  const at = positionsForNonSpace(layer, from, to);
  if (!at) return null;
  const range = layer.ownerDocument.createRange();
  range.setStart(at.start[0], at.start[1]);
  range.setEnd(at.end[0], at.end[1]);
  return range;
}

export function positionsForNonSpace(layer: Element, from: number, to: number): { start: [Node, number]; end: [Node, number] } | null {
  if (to <= from) return null;
  const walker = layer.ownerDocument.createTreeWalker(layer, 4 /* NodeFilter.SHOW_TEXT */);
  let index = 0;
  let start: [Node, number] | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    for (let i = 0; i < text.length; i++) {
      if (isSpace(text[i])) continue;
      if (index === from) start = [node, i];
      if (index === to - 1) return start ? { start, end: [node, i + 1] } : null;
      index += 1;
    }
  }
  return null;
}
