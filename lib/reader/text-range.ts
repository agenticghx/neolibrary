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
