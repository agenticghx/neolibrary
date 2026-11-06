import * as CFI from "foliate-js/epubcfi.js";
import { positionsForOffsets } from "@/lib/reader/text-range";

/**
 * M41 R5: a paper's citations drawn as written, as numbers or not at all (Aa > Citations).
 *
 * Written for the sessions that change it. The server finds each citation and the entry it names
 * (lib/library/citations.ts). As a page loads, each citation's words are wrapped in two spans:
 *
 *   <span data-nl-cite="cite" data-n="[12]" title="the entry"><span data-nl-cite="text">(Waud and Parker, 1971)</span></span>
 *
 * The words stay in the page, so search, read-along, X-ray and every stored offset into a paragraph's text are
 * unchanged. Only CSS (settings.ts, `citationCss`) chooses what shows: the words, the number (`::after`, which is
 * not text), or nothing. The reference list's entries get their number as an attribute (`data-nl-ref`), drawn by
 * `::before`.
 *
 * Notes and the reading place are kept by CFI (an address counted through a page's elements). The spans would move
 * every address after them, so the view's own CFI functions are replaced (`filterCitationCfis`) by ones told to
 * look through them (foliate's filter, FILTER_SKIP; scripts/patch-foliate-cfi.mjs makes a place inside a span count
 * from the paragraph). An address is then the same with or without the spans, as notes made before this existed
 * expect.
 */

export type CiteMark = { cfi: string; chapterIndex: number; start: number; end: number; label: string; title: string };
export type RefMark = { cfi: string; chapterIndex: number; n: number };
export type ReaderCitations = { cites: CiteMark[]; refs: RefMark[]; unmatched: number };

export const CITE_ATTR = "data-nl-cite";

/** Foliate's filter: the reader's citation spans are looked through; everything else counts as usual. */
export function citeFilter(node: Node): number {
  return node.nodeType === 1 && (node as Element).hasAttribute(CITE_ATTR) ? 3 /* NodeFilter.FILTER_SKIP */ : 1 /* FILTER_ACCEPT */;
}

const inCite = (n: Node | null): Element | null => {
  for (let x: Node | null = n; x; x = x.parentNode) if (x.nodeType === 1 && (x as Element).hasAttribute(CITE_ATTR)) return x as Element;
  return null;
};

/** A boundary on a span itself (an element and a child count) as the same place in the span's text. */
function inText(node: Node, offset: number): [Node, number] {
  if (node.nodeType !== 1 || !inCite(node)) return [node, offset];
  const texts = (from: Node) => {
    const out: Node[] = from.nodeType === 3 ? [from] : [];
    const walker = node.ownerDocument!.createTreeWalker(from, 4 /* SHOW_TEXT */);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) out.push(t);
    return out;
  };
  const child = node.childNodes[offset];
  const first = child ? texts(child)[0] : undefined;
  if (first) return [first, 0];
  const last = texts(node).at(-1);
  return last ? [last, (last.nodeValue ?? "").length] : [node, offset];
}

/** A text node cut in two at `at`, as Text.splitText does; the second part, after the first. */
function split(node: Node, at: number): Node {
  const value = node.nodeValue ?? "";
  const rest = node.ownerDocument!.createTextNode(value.slice(at));
  node.nodeValue = value.slice(0, at);
  node.parentNode!.insertBefore(rest, node.nextSibling);
  return rest;
}

type RangeLike = { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number; collapsed: boolean };

/** A CFI for a range on a page, counted as if the citation spans were not there. */
export function cfiOfRange(range: RangeLike): string {
  const [sc, so] = inText(range.startContainer, range.startOffset);
  const [ec, eo] = inText(range.endContainer, range.endOffset);
  return CFI.fromRange({ startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo, collapsed: range.collapsed } as unknown as Range, citeFilter);
}

type SectionLike = { cfi?: string };
type BookLike = { sections: SectionLike[]; resolveCFI?(cfi: string): { index: number; anchor: (doc: Document) => Range } };
type ViewLike = { book?: BookLike; getCFI(index: number, range?: Range): string };

/**
 * The view's CFI functions, told to look through citation spans: `getCFI` (every place, note and selection the
 * reader saves, and the place foliate reports on each turn) and the book's `resolveCFI` (every note drawn, every
 * jump to a place). Only for an EPUB (a book with `resolveCFI`); a PDF's pages have no spans.
 */
export function filterCitationCfis(view: ViewLike) {
  const book = view.book;
  if (!book?.resolveCFI) return;
  const resolveOwn = book.resolveCFI.bind(book);
  view.getCFI = (index: number, range?: Range) => {
    const base = book.sections[index]?.cfi ?? CFI.fake.fromIndex(index);
    return range ? CFI.joinIndir(base, cfiOfRange(range)) : base;
  };
  book.resolveCFI = (cfi: string) => {
    const { index } = resolveOwn(cfi);
    const parts = CFI.parse(cfi);
    (parts.parent ?? parts).shift();
    return { index, anchor: (doc: Document) => CFI.toRange(doc, parts, citeFilter) };
  };
}

/**
 * Wraps one chapter's citations and numbers its reference entries, as the page loads (before foliate lays it out or
 * draws any note on it). Each paragraph is found by its address; the offsets into its stored text become places in
 * its text nodes, as a spoken word's do. A citation may hold whole elements ("(Greco <i>et al.</i>, 1990)"); one
 * that starts or ends inside an element and outside it is left unwrapped, as written. Returns how many were wrapped.
 */
export function wrapCitations(doc: Document, index: number, data: ReaderCitations, resolve: (cfi: string) => Element | null): number {
  let wrapped = 0;
  const byCfi = new Map<string, Element | null>();
  const elementOf = (cfi: string) => {
    if (!byCfi.has(cfi)) byCfi.set(cfi, resolve(cfi));
    return byCfi.get(cfi) ?? null;
  };
  for (const r of data.refs) {
    if (r.chapterIndex !== index) continue;
    elementOf(r.cfi)?.setAttribute("data-nl-ref", String(r.n));
  }
  for (const c of data.cites) {
    if (c.chapterIndex !== index) continue;
    const el = elementOf(c.cfi);
    if (!el) continue;
    const at = positionsForOffsets(el, c.start, c.end);
    if (!at) continue;
    let [first, from] = at.start;
    let last = at.end[0];
    const to = at.end[1];
    // Both ends must sit in text with one parent: a citation that crosses an element's edge is left as written.
    if (first.nodeType !== 3 || last.nodeType !== 3 || first.parentNode !== last.parentNode || inCite(first)) continue;
    // The space before a citation in brackets goes with it, so hiding it leaves "synergy." and not "synergy .".
    const space = from > 0 && /\s/.test((first.nodeValue ?? "")[from - 1]);
    if (space) from -= 1;
    // Split the text at both ends (the end first, so the start's offset still holds), then move what lies between.
    if (to < (last.nodeValue ?? "").length) split(last, to);
    if (from > 0) {
      const rest = split(first, from);
      if (first === last) last = rest;
      first = rest;
    }
    const text = doc.createElement("span");
    text.setAttribute(CITE_ATTR, "text");
    first.parentNode!.insertBefore(text, first);
    for (let n: Node | null = first; n; ) {
      const next: Node | null = n === last ? null : n.nextSibling;
      text.append(n);
      n = next;
    }
    const cite = doc.createElement("span");
    cite.setAttribute(CITE_ATTR, "cite");
    cite.setAttribute("data-n", c.label);
    if (space) cite.setAttribute("data-space", "");
    if (c.title) cite.setAttribute("title", c.title);
    text.before(cite);
    cite.append(text);
    wrapped++;
  }
  return wrapped;
}
