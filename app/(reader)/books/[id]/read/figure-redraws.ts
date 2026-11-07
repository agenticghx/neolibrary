/**
 * M41 R6: a paper's figures redrawn cleanly (lib/library/figure-redraws.ts), shown in place of the printed ones.
 *
 * Only the picture's address changes: no element is added to or taken from the book's page, so every note's anchor
 * (CFI) stays where it was, and the printed picture's address is kept on the element to switch back. The picture's
 * holder (the paragraph or <figure> that holds only it) is marked, and the book's style writes "Redrawn by AI…" under
 * it (settings.ts): drawn by CSS, so it is not text a search, a note or Listen would meet.
 * A page's elements live in the book's own frame, so nothing here uses `instanceof`.
 */
import type { FigureMode } from "./settings";

export type ReaderFigure = { chapter: string; nth: number; id: string; model: string; at: string };

export const REDRAWN_ATTR = "data-nl-redrawn";

type Img = {
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  dataset: DOMStringMap;
  parentElement: Holder | null;
  closest(sel: string): Holder | null;
};
type Holder = { toggleAttribute(n: string, on: boolean): void; childNodes: ArrayLike<{ nodeType: number; nodeValue: string | null }>; tagName: string; querySelectorAll(s: string): ArrayLike<unknown> };
type Doc = { querySelectorAll(sel: string): ArrayLike<unknown> };

/** The element that holds only this picture (a Markdown paper's <p class="figure">, or a <figure>), if any. */
function holderOf(img: Img): Holder | null {
  const figure = img.closest("figure");
  if (figure && figure.querySelectorAll("img").length === 1) return figure;
  const p = img.parentElement;
  if (!p || !/^(p|div)$/i.test(p.tagName)) return null;
  const alone = Array.from(p.childNodes).every((n) => n === (img as unknown) || (n.nodeType === 3 && !n.nodeValue?.trim()));
  return alone ? p : null;
}

/**
 * Marks this chapter's redrawn pictures (the n-th <img> of the chapter's page, as the laptop script counted them) with
 * the printed picture's address and the redraw's, then fetches each redraw and shows it if `mode()` (asked once it has
 * arrived) says Redrawn. Returns how many were found.
 *
 * The redraw is fetched by `load` from the reader's own page and handed to the book's page as a blob: address, as
 * foliate hands it the book's own pictures. Safari's engine (WebKit, so every browser on an iPad) sends a picture
 * request from the book's page without the sign-in cookie, and the site answered 401 (seen live, 2026-11-07).
 */
export function placeRedraws(
  doc: Doc,
  chapter: string | undefined,
  figures: ReaderFigure[],
  bookId: string,
  origin: string,
  mode: () => FigureMode,
  load: (url: string) => Promise<string>,
): number {
  const mine = chapter ? figures.filter((f) => f.chapter === chapter) : [];
  if (!mine.length) return 0;
  const imgs = Array.from(doc.querySelectorAll("img")) as Img[];
  let placed = 0;
  for (const f of mine) {
    const img = imgs[f.nth];
    const printed = img?.getAttribute("src");
    if (!img || !printed) continue;
    img.dataset.nlPrinted ??= printed;
    const url = `${origin}/api/books/${bookId}/figures/${f.id}.svg`;
    img.dataset.nlRedrawSrc = url;
    img.dataset.nlModel = f.model;
    placed++;
    load(url).then(
      (blob) => {
        if (img.dataset.nlRedrawSrc !== url) return;
        img.dataset.nlRedraw = blob;
        showFigures(doc, mode());
      },
      () => undefined, // not fetched: the printed picture stays, with no label
    );
  }
  return placed;
}

/** Shows each marked picture redrawn or as printed, and the "Redrawn by AI" line under the redrawn ones. */
export function showFigures(doc: Doc, mode: FigureMode) {
  for (const img of Array.from(doc.querySelectorAll("img[data-nl-redraw]")) as Img[]) {
    const redrawn = mode === "redrawn";
    const want = redrawn ? img.dataset.nlRedraw : img.dataset.nlPrinted;
    if (want && img.getAttribute("src") !== want) img.setAttribute("src", want);
    holderOf(img)?.toggleAttribute(REDRAWN_ATTR, redrawn);
  }
}

/** The name the reader sees for the model that redrew a figure: "Claude Opus 5.5" from "claude-opus-5-5". */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id);
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}
