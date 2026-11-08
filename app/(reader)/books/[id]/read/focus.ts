/**
 * Focus (M21), inside an EPUB page's frame: a reading ruler (a soft band on one line, the rest of the text dimmed) or
 * paragraph focus (every paragraph dimmed but one). The colours are in settings.ts (bookCss); this file decides which
 * line or paragraph is in focus and dims the rest.
 *
 * Nothing is wrapped around the book's text: the dimming is a custom highlight (CSS Custom Highlight API, as the
 * spoken word is), so the addresses of passages (CFIs, counted inside <body>) do not move. The ruler's band itself is
 * not in the page: Reader.tsx draws it over the book (the lens), at the place on screen that focusAt returns, so it
 * can stay still while the text scrolls under it (Samuel, 2026-11-08: "In Apple the ruler is stationary and scrolling
 * moves the text"). It takes no clicks, so selecting text, notes and highlights work as before. The spoken word is
 * painted over the dimming (its highlight has the higher priority).
 */
import type { FocusMode, RulerLines } from "./settings";

/** The blocks that count as a paragraph: the innermost one around the pointer is the one in front of the reader. */
export const FOCUS_BLOCKS = "p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6, pre, figcaption, td, th";
const DIM = "nl-dim";

export type Box = { left: number; top: number; right: number; bottom: number };
/** The ruler's band, with the middle of its first line (`lead`): the line the reader put it on. */
export type Band = Box & { lead: number };

/**
 * The lines of a block inside one column, from the boxes of its text (Range.getClientRects): boxes whose middles
 * fall inside one another's height are on the same line. Boxes outside the column (the block's part on another
 * page) are left out.
 */
export function linesIn(boxes: Box[], column: Box): Box[] {
  const inside = boxes
    .filter((b) => b.right - b.left > 0.5 && b.bottom - b.top > 0.5)
    .filter((b) => b.left >= column.left - 2 && b.right <= column.right + 2 && b.top >= column.top - 2 && b.bottom <= column.bottom + 2)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Box[] = [];
  for (const b of inside) {
    const mid = (b.top + b.bottom) / 2;
    const line = lines.find((l) => mid > l.top && mid < l.bottom);
    if (!line) {
      // Copied field by field: a DOMRect's fields are getters, which a spread ({ ...b }) leaves behind.
      lines.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
      continue;
    }
    line.left = Math.min(line.left, b.left);
    line.right = Math.max(line.right, b.right);
    line.top = Math.min(line.top, b.top);
    line.bottom = Math.max(line.bottom, b.bottom);
  }
  return lines;
}

/**
 * The line at height y, or else the nearest one above or below. Only the height counts: a pointer past the end of a
 * short last line is still on that line.
 */
export function lineAt(lines: Box[], y: number): Box | null {
  let best: Box | null = null;
  let far = Infinity;
  for (const l of lines) {
    const d = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0;
    if (d < far) {
      far = d;
      best = l;
    }
  }
  return best;
}

/** The box holding (x, y), or else the nearest one. */
export function nearest<T extends Box>(boxes: T[], x: number, y: number): T | null {
  let best: T | null = null;
  let far = Infinity;
  for (const b of boxes) {
    const dx = x < b.left ? b.left - x : x > b.right ? x - b.right : 0;
    const dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
    const d = dx * dx + dy * dy;
    if (d < far) {
      far = d;
      best = b;
    }
  }
  return best;
}

type FrameWindow = Window & { CSS: typeof CSS; Highlight: typeof Highlight };
type Caret = { node: Node; offset: number };
/** What is in focus on one page, so a pointer that stays on the same line does no work. */
const shown = new WeakMap<Document, { block: Element; line: Box | null; band?: Band }>();

/**
 * Turns Focus on or off on one page, and sets how many lines the ruler covers. Whatever was in focus is cleared;
 * Reader.tsx puts it back where it belongs.
 */
export function setFocusMode(doc: Document, mode: FocusMode, lines: RulerLines = 1) {
  const root = doc.documentElement;
  if (!root) return;
  if (mode === "off") root.removeAttribute("data-nl-focus");
  else root.setAttribute("data-nl-focus", mode);
  root.setAttribute("data-nl-ruler-lines", String(lines));
  clearFocus(doc);
}

const linesOf = (doc: Document) => Math.min(3, Math.max(1, Number(doc.documentElement?.getAttribute("data-nl-ruler-lines")) || 1));

export function clearFocus(doc: Document) {
  shown.delete(doc);
  (doc.defaultView as FrameWindow | null)?.CSS?.highlights?.delete(DIM);
}

const modeOf = (doc: Document) => (doc.documentElement?.getAttribute("data-nl-focus") as FocusMode | null) ?? "off";

/** The paragraph at a point of the page (frame coordinates), if the point is on text. */
export function blockAt(doc: Document, x: number, y: number): Element | null {
  const el = doc.elementFromPoint(x, y);
  if (!el || !doc.body?.contains(el) || el === doc.body) return null;
  const block = el.closest(FOCUS_BLOCKS);
  if (block) return block;
  // A book that makes its paragraphs of <div>s: a div with text of its own. Not a div that only wraps paragraphs
  // (the gap between two paragraphs would put the whole chapter in focus).
  const div = el.closest("div");
  return div && Array.from(div.childNodes).some((n) => n.nodeType === 3 && n.nodeValue?.trim()) ? div : null;
}

/**
 * Puts the focus on the line (ruler) or paragraph (paragraph focus) at a point of the page, in the frame's own
 * coordinates (a pointer event's clientX and clientY). Returns the ruler's band for that line (the line's full height,
 * across its column, in the frame's coordinates), or for paragraph focus the paragraph's box; null when the point is
 * not on text, and then what is in focus stays. `dimIfNone`: when the point is not on text, dim the whole page
 * instead (the ruler held still while a gap between paragraphs scrolls under it).
 */
export function focusAt(doc: Document, x: number, y: number, dimIfNone = false): Band | Box | null {
  const mode = modeOf(doc);
  if (mode === "off") return null;
  const block = blockAt(doc, x, y);
  if (!block) {
    if (dimIfNone && mode === "ruler") dimAll(doc);
    return null;
  }
  if (mode === "paragraph") {
    focusBlock(doc, block);
    return box(block.getBoundingClientRect());
  }
  const was = shown.get(doc);
  if (was?.block === block && was.line && was.band && x >= was.line.left - 4 && x <= was.line.right + 4 && y >= was.line.top && y <= was.line.bottom) return was.band;
  // The part of the paragraph in the pointer's column (it may run over two pages side by side), and its lines.
  const column = nearest(Array.from(block.getClientRects()), x, y);
  if (!column) return null;
  const range = doc.createRange();
  range.selectNodeContents(block);
  const line = lineAt(linesIn(Array.from(range.getClientRects()), column), y);
  if (!line) return null;
  if (was?.block === block && was.line && was.band && was.line.top === line.top && was.line.left === line.left) return was.band;
  // The line, and the ones after it in the same column when the ruler covers more than one (into the next paragraphs).
  const rows = [{ block, line }, ...linesAfter(doc, block, column, line, linesOf(doc) - 1)];
  const last = rows[rows.length - 1];
  // The band fills the lines' height (the text's boxes are shorter than a line), across the column.
  const pad = (b: Element, l: Box) => {
    const lineHeight = parseFloat(doc.defaultView?.getComputedStyle(b).lineHeight ?? "") || (l.bottom - l.top) * 1.3;
    return Math.max(0, (lineHeight - (l.bottom - l.top)) / 2);
  };
  const band: Band = {
    left: column.left,
    right: column.right,
    top: line.top - pad(block, line),
    bottom: last.line.bottom + pad(last.block, last.line),
    lead: (line.top + line.bottom) / 2,
  };
  shown.set(doc, { block, line, band });
  const keep = lineRange(doc, block, line);
  if (last.line !== line) {
    const end = lineRange(doc, last.block, last.line);
    try {
      keep.setEnd(end.endContainer, end.endOffset);
    } catch {
      // Leave the first line alone in focus.
    }
  }
  dimAllBut(doc, keep);
  return band;
}

/**
 * Up to `count` lines after `line` in the same column (the column's horizontal extent): the rest of its paragraph,
 * then the paragraphs after it. Stops at the foot of the column (the next lines are in another column or on the next
 * page).
 */
function linesAfter(doc: Document, block: Element, column: Box, line: Box, count: number): { block: Element; line: Box }[] {
  const out: { block: Element; line: Box }[] = [];
  if (count <= 0) return out;
  const inColumn = (l: Box) => l.left >= column.left - 2 && l.right <= column.right + 2;
  const linesOfBlock = (b: Element) => {
    const range = doc.createRange();
    range.selectNodeContents(b);
    const boxes = Array.from(range.getClientRects());
    const span = { left: column.left, right: column.right, top: -Infinity, bottom: Infinity };
    return linesIn(boxes, span).filter(inColumn);
  };
  let below = line.bottom - 1;
  for (const l of linesOfBlock(block)) {
    if (out.length >= count) return out;
    if (l.top > below) {
      out.push({ block, line: l });
      below = l.bottom - 1;
    }
  }
  // The paragraphs after it, in reading order: innermost blocks only (a blockquote's paragraphs, not the blockquote).
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  walker.currentNode = block;
  let looked = 0;
  for (let node = walker.nextNode() as Element | null; node && out.length < count && looked < 40; node = walker.nextNode() as Element | null) {
    if (block.contains(node) || !node.matches(FOCUS_BLOCKS) || node.querySelector(FOCUS_BLOCKS)) continue;
    looked++;
    const lines = linesOfBlock(node);
    if (!lines.length) continue;
    // The next paragraph starts in another column or page: the column ends here.
    if (lines[0].top <= below) return out;
    for (const l of lines) {
      if (out.length >= count) break;
      if (l.top > below) {
        out.push({ block: node, line: l });
        below = l.bottom - 1;
      }
    }
  }
  return out;
}

const box = (b: Box): Box => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });

/** Paragraph focus on one block: the paragraph read aloud, or the first one on a page turned to with the keyboard. */
export function focusBlock(doc: Document, block: Element) {
  if (modeOf(doc) !== "paragraph" || shown.get(doc)?.block === block) return;
  shown.set(doc, { block, line: null });
  const range = doc.createRange();
  range.selectNodeContents(block);
  dimAllBut(doc, range);
}

/** The block in focus on this page now, if any (for the tests and for Reader.tsx). */
export const focusedBlock = (doc: Document) => shown.get(doc)?.block ?? null;

/** The caret position at a point (Chromium and Firefox name it one way, Safari the other). */
function caretAt(doc: Document, x: number, y: number): Caret | null {
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = d.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** The text of one line of a block: from the caret at its left end to the caret at its right end. */
function lineRange(doc: Document, block: Element, line: Box): Range {
  const whole = doc.createRange();
  whole.selectNodeContents(block);
  const mid = (line.top + line.bottom) / 2;
  const from = caretAt(doc, line.left + 1, mid);
  const to = caretAt(doc, line.right - 1, mid);
  if (!from || !to || !block.contains(from.node) || !block.contains(to.node)) return whole;
  try {
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range.collapsed ? whole : range;
  } catch {
    return whole;
  }
}

/** Dims all the page's text: the ruler is over no line (a gap between paragraphs, or the margin). */
function dimAll(doc: Document) {
  const win = doc.defaultView as FrameWindow | null;
  if (!win?.CSS?.highlights || !win.Highlight || !doc.body) return;
  shown.delete(doc);
  const all = doc.createRange();
  all.selectNodeContents(doc.body);
  const dim = new win.Highlight(all);
  dim.priority = -1;
  win.CSS.highlights.set(DIM, dim);
}

/** Dims all the page's text before and after `keep`. */
function dimAllBut(doc: Document, keep: Range) {
  const win = doc.defaultView as FrameWindow | null;
  if (!win?.CSS?.highlights || !win.Highlight || !doc.body) return;
  const before = doc.createRange();
  before.setStart(doc.body, 0);
  before.setEnd(keep.startContainer, keep.startOffset);
  const after = doc.createRange();
  after.setStart(keep.endContainer, keep.endOffset);
  after.setEnd(doc.body, doc.body.childNodes.length);
  const dim = new win.Highlight(before, after);
  // Under the spoken word (priority 0), so the word read aloud stays clear wherever it is.
  dim.priority = -1;
  win.CSS.highlights.set(DIM, dim);
}

/** A place in the text: a text node and a character in it. Unlike a box on screen, it survives a new layout. */
export type Spot = { node: Node; offset: number };

/**
 * The first letter of a range that is not a space: where the text on screen starts. Foliate's range can start with
 * a space left at the end of the page before.
 */
export function firstLetter(range: Range): Spot | null {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return null;
  // A walker never returns its own root, and the range may lie inside one text node (a long paragraph).
  const common = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(common.nodeType === Node.TEXT_NODE ? (common.parentNode ?? common) : common, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const text = node.nodeValue ?? "";
    const from = node === range.startContainer ? range.startOffset : 0;
    const at = text.slice(from).search(/\S/);
    if (at >= 0) return { node, offset: from + at };
  }
  return null;
}

/**
 * The first letter of a range that lies inside a box on screen (`inside`, given the letter's box in the page's
 * coordinates): where the text the reader sees starts. While WebKit lays a page out again, foliate's range for the
 * text on screen can still start on the page before (2026-11-08). Gives up after `most` letters.
 */
export function firstLetterInside(range: Range, inside: (box: DOMRect) => boolean, most = 4000): Spot | null {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return null;
  const common = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(common.nodeType === Node.TEXT_NODE ? (common.parentNode ?? common) : common, NodeFilter.SHOW_TEXT);
  const letter = doc.createRange();
  let tried = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const text = node.nodeValue ?? "";
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : text.length;
    for (let i = from; i < to; i++) {
      if (/\s/.test(text[i])) continue;
      if (++tried > most) return null;
      letter.setStart(node, i);
      letter.setEnd(node, i + 1);
      const box = Array.from(letter.getClientRects()).find((b) => b.width > 0 && b.height > 0);
      if (box && inside(box)) return { node, offset: i };
    }
  }
  return null;
}

/** How long the place stays marked after a layout switch, fading at the end (settings.ts, nl-place). */
export const PLACE_MARK_MS = 2400;

/**
 * After a switch of layout (Pages or Scroll, One or Two pages), a soft band on the line holding `spot` for a moment,
 * so the eye finds the place: in Two pages the words read last can sit in the right column (Samuel, 2026-10-26).
 * It is one element after <body>, so the addresses of passages do not move.
 */
export function markLine(doc: Document, spot: Spot) {
  if (!spot.node.isConnected || spot.node.ownerDocument !== doc || !doc.documentElement) return;
  const length = spot.node.nodeValue?.length ?? 0;
  const letter = doc.createRange();
  letter.setStart(spot.node, Math.min(spot.offset, length));
  letter.setEnd(spot.node, Math.min(spot.offset + 1, length));
  const box = Array.from(letter.getClientRects()).find((b) => b.width > 0 && b.height > 0);
  if (!box) return;
  const x = (box.left + box.right) / 2;
  const y = (box.top + box.bottom) / 2;
  const block = spot.node.parentElement?.closest(FOCUS_BLOCKS) ?? spot.node.parentElement;
  const column = block ? nearest(Array.from(block.getClientRects()), x, y) : null;
  let line: Box = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  if (block && column) {
    const whole = doc.createRange();
    whole.selectNodeContents(block);
    line = lineAt(linesIn(Array.from(whole.getClientRects()), column), y) ?? line;
  }
  const lineHeight = (block && parseFloat(doc.defaultView?.getComputedStyle(block).lineHeight ?? "")) || (line.bottom - line.top) * 1.3;
  const pad = Math.max(0, (lineHeight - (line.bottom - line.top)) / 2);
  doc.querySelector(":root > [data-nl-place]")?.remove();
  const mark = doc.createElement("div");
  mark.setAttribute("data-nl-place", "");
  mark.setAttribute("aria-hidden", "true");
  const left = column?.left ?? line.left;
  mark.style.width = `${(column?.right ?? line.right) - left}px`;
  mark.style.height = `${line.bottom - line.top + 2 * pad}px`;
  mark.style.transform = `translate(${left}px, ${line.top - pad}px)`;
  doc.documentElement.append(mark);
  doc.defaultView?.setTimeout(() => mark.remove(), PLACE_MARK_MS);
}
