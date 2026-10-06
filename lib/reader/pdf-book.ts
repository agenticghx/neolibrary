/**
 * Turns a PDF into a "book" object that foliate-js's fixed-layout renderer can
 * show: one section per page, each page drawn on a canvas with a transparent
 * text layer on top (so text can be selected and, later, highlighted).
 * Adapted from foliate-js's pdf.js adapter (MIT, John Factotum), which is not
 * in its npm release; uses pdfjs-dist (Apache-2.0).
 */
import { mark, markTime, measure } from "@/lib/perf-marks";

type Pdfjs = typeof import("pdfjs-dist");
type TextContent = Awaited<ReturnType<import("pdfjs-dist").PDFPageProxy["getTextContent"]>>;

// From pdf.js 6.4's own stylesheet (pdfjs-dist/web/pdf_viewer.css, ".textLayer"):
// invisible, selectable text over the canvas. pdf.js sets each span's
// --font-height, --scale-x and --rotate, and the layer's --min-font-size;
// these rules turn them into the span's size and stretch, so each word lies
// over its printed glyphs (without them, selections and the read-along
// highlight drift off the words: M13 (e)). On a page the PDF turns (a
// landscape table, say), pdf.js draws the picture turned and marks the text
// layer with data-main-rotation; the last three rules turn the text with it.
const TEXT_LAYER_CSS = `
.textLayer { color-scheme: only light; position: absolute; text-align: initial; inset: 0; overflow: clip; opacity: 1; line-height: 1;
  letter-spacing: normal; word-spacing: normal; text-size-adjust: none; forced-color-adjust: none; transform-origin: 0 0;
  caret-color: CanvasText; z-index: 0;
  --min-font-size: 1; --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size)); --min-font-size-inv: calc(1 / var(--min-font-size)); }
.textLayer :is(span, br) { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; user-select: text; }
.textLayer > :not(.markedContent), .textLayer .markedContent span:not(.markedContent) { z-index: 1;
  --font-height: 0; font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1; --rotate: 0deg; transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
.textLayer .markedContent { display: contents; }
.textLayer span[role="img"] { user-select: none; cursor: default; }
.textLayer ::selection { background: rgb(55 105 99 / 0.3); }
.textLayer br::selection { background: transparent; }
.textLayer .endOfContent { display: block; position: absolute; inset: 100% 0 0; z-index: 0; cursor: default; user-select: none; }
[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
`;

// The word being read aloud (M13 (e)): the text layer's letters are
// transparent and lie over the page's picture, so the spoken word gets a
// see-through background, drawn over the printed letters. It is the light
// theme's --highlight-active (#9cc4b6 in app/tokens.css) in every theme (a
// PDF page is always white), at half strength: black letters under it keep a
// contrast of about 4.9 to 1 with the tinted paper.
const SPOKEN_CSS = `::highlight(nl-spoken) { background-color: rgb(156 196 182 / 0.5); }`;

/** Fired on a page's document when its text layer is complete (the page is shown) and each time it is laid out for a new size. */
export const TEXT_LAYER_EVENT = "nl-textlayer";

type TocItem = { label: string; href: string; subitems: TocItem[] | null };
type OutlineItem = { title: string; dest: unknown; items: OutlineItem[] };

export async function makePdfBook(file: Blob) {
  // The legacy build supports today's browsers (the modern one needs very new JavaScript).
  const pdfjsLib: Pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: "/pdfjs/cmaps/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  });
  const pdf = await task.promise;

  /**
   * A shown page: the size it is drawn at or being drawn at (NaN after a
   * drawing failed), which drawing is the newest, its text layer and the
   * size that is laid out for, and the picture being drawn, if any. foliate asks for a drawing every time the
   * page's frame changes size, many times while a window is dragged, without
   * waiting for the last one.
   */
  type Shown = { scale: number; run: number; text: InstanceType<Pdfjs["TextLayer"]> | null; laidOut: number; drawing: { cancel(): void } | null };
  const shown = new WeakMap<Document, Shown>();
  /**
   * The text of the page after the one shown, fetched ahead (pdf.js reads a
   * page's text in its worker, which takes tens of milliseconds on a slow
   * machine): when the reading turns to it, its text layer is built at once
   * and the first word on it can be lit on time. Null while it is fetched;
   * the last few pages only.
   */
  const textAhead = new Map<number, TextContent | null>();
  const fetchTextOf = (pageNumber: number) => {
    if (pageNumber > pdf.numPages || textAhead.has(pageNumber)) return;
    textAhead.set(pageNumber, null);
    pdf
      .getPage(pageNumber)
      .then((p) => p.getTextContent())
      .then(
        (text) => textAhead.has(pageNumber) && textAhead.set(pageNumber, text),
        () => textAhead.delete(pageNumber),
      );
    if (textAhead.size > 4) textAhead.delete(textAhead.keys().next().value!);
  };
  const unexpected = (e: unknown) => {
    if (!(e instanceof pdfjsLib.AbortException) && !(e instanceof pdfjsLib.RenderingCancelledException)) console.warn(e);
  };

  /**
   * The page after the one shown, drawn ahead once into a small canvas that is
   * then thrown away. Drawing a page is when pdf.js hands the browser each font
   * the page uses for the first time, and a font the browser must look for
   * among the device's fonts holds up the page while it looks (CI's Linux
   * WebKit: a failed lookup for an italic Times held the page 18-55 ms at the
   * page turn, LEARNING_LOG Iterations 39 and 42). Drawn ahead, that happens
   * while this page is read; and pdf.js keeps the page's drawing instructions,
   * so the turn draws without waiting for its worker. The canvas is small
   * whatever the zoom (pdf.js asks for fonts at 16 to 100 px however small it
   * draws), so a new size needs nothing here. One page at a time; a page
   * already shown is skipped.
   */
  const warmed = new Set<number>();
  let warmingUp = false;
  let closed = false;
  const warmUp = (pageNumber: number) => {
    if (closed || warmingUp || pageNumber > pdf.numPages || warmed.has(pageNumber)) return;
    warmed.add(pageNumber);
    warmingUp = true;
    setTimeout(async () => {
      // In this document, not a page's frame: pdf.js gives fonts to this document (as for the picture below).
      const canvas = document.createElement("canvas");
      try {
        if (closed) return;
        mark("nl:warmup-start", { page: pageNumber - 1 });
        const page = await pdf.getPage(pageNumber);
        if (closed) return;
        const { width, height } = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 128 / Math.max(width, height) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        // None when out of canvas memory: the turn loads the fonts, as before.
        if (context) await page.render({ canvas, canvasContext: context, viewport }).promise;
        mark("nl:warmup-done", { page: pageNumber - 1 });
      } catch (e) {
        unexpected(e); // a book being closed cancels the drawing: not reported
      } finally {
        warmingUp = false;
        // Freed now, not when the canvas is garbage-collected (pdf.js does the same with its own).
        canvas.width = canvas.height = 0;
      }
    }, 0);
  };

  /**
   * Draws a page at `zoom` in its frame's document. The text layer is built
   * once per showing, at the same time as the picture (the word being read
   * can be lit before the picture is ready); a new size draws a new picture
   * and, once it is ready, resizes the picture and the text together, so the
   * text always lies over its letters. An older drawing still under way is
   * cancelled; one that finishes late is dropped.
   */
  const render = async (pageNumber: number, doc: Document, zoom: number) => {
    const scale = zoom * devicePixelRatio;
    let state = shown.get(doc);
    if (state?.scale === scale) return;
    if (!state) shown.set(doc, (state = { scale, run: 0, text: null, laidOut: scale, drawing: null }));
    state.scale = scale;
    const run = ++state.run;
    state.drawing?.cancel();
    state.drawing = null;
    const page = await pdf.getPage(pageNumber);
    if (state.run !== run) return;
    const viewport = page.getViewport({ scale });
    const root = doc.documentElement;
    const sizeTo = () => {
      root.style.transform = `scale(${1 / devicePixelRatio})`;
      root.style.transformOrigin = "top left";
      root.style.setProperty("--scale-factor", String(scale));
    };
    if (!state.text) {
      sizeTo();
      const container = doc.querySelector(".textLayer") as HTMLElement;
      // Built at once (a newer drawing must find it there): from the text fetched ahead if it has
      // arrived, or else as pdf.js reads it. (A stream made here to wait for the text broke the
      // page's text layer in WebKit: pdf.js found no text in it.)
      const fetchedAhead = textAhead.get(pageNumber);
      const textContentSource = fetchedAhead ?? page.streamTextContent();
      mark("nl:textlayer-start", { page: pageNumber - 1, ahead: fetchedAhead != null });
      const textStart = markTime();
      state.text = new pdfjsLib.TextLayer({ textContentSource, container, viewport });
      state.laidOut = scale;
      fetchTextOf(pageNumber + 1);
      // Shown: its own drawing loads its fonts, so it is never drawn ahead.
      warmed.add(pageNumber);
      state.text.render().then(() => {
        const end = doc.createElement("div");
        end.className = "endOfContent";
        container.append(end);
        mark("nl:textlayer-ready", { page: pageNumber - 1 });
        measure("nl:textlayer", textStart, { page: pageNumber - 1 });
        // The page's text is all there now: a word waiting to be lit can be.
        doc.dispatchEvent(new Event(TEXT_LAYER_EVENT));
      }, unexpected);
    }
    // The canvas must belong to this document (pdf.js loads fonts here), then moves into the page frame.
    const canvas = document.createElement("canvas");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    const context = canvas.getContext("2d");
    // None when the browser is out of canvas memory (iPhones have a limit):
    // the text is still there, and the next request, even at this size, tries again.
    if (!context) {
      state.scale = NaN;
      return console.warn(`Page ${pageNumber}: no canvas to draw on`);
    }
    mark("nl:draw-start", { page: pageNumber - 1, scale });
    const drawStart = markTime();
    const drawing = page.render({ canvas, canvasContext: context, viewport });
    state.drawing = drawing;
    try {
      await drawing.promise;
    } catch (e) {
      // Cancelled by a newer drawing, which carries on; or failed: the next request tries again.
      if (state.run === run) {
        state.drawing = null;
        state.scale = NaN;
      }
      unexpected(e);
      return;
    }
    if (state.run !== run) return;
    state.drawing = null;
    sizeTo();
    doc.querySelector("#canvas")!.replaceChildren(doc.adoptNode(canvas));
    mark("nl:draw-done", { page: pageNumber - 1, scale });
    measure("nl:draw", drawStart, { page: pageNumber - 1, scale });
    // This page is drawn: the next page's fonts now, while this one is read.
    warmUp(pageNumber + 1);
    if (state.laidOut !== scale) {
      // The same text, laid out again for the new size: a word lit on it stays lit.
      state.text.update({ viewport });
      state.laidOut = scale;
      doc.dispatchEvent(new Event(TEXT_LAYER_EVENT));
    }
  };

  const pageDoc = async (pageNumber: number) => {
    const viewport = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 });
    const src = URL.createObjectURL(
      new Blob(
        [
          `<!DOCTYPE html><html lang="en" data-page="${pageNumber - 1}"><meta charset="utf-8">
<meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
<style>html, body { margin: 0; padding: 0; }
:root { --user-unit: 1; --total-scale-factor: calc(var(--scale-factor) * var(--user-unit)); --scale-round-x: 1px; --scale-round-y: 1px; }
${TEXT_LAYER_CSS}${SPOKEN_CSS}</style>
<div id="canvas"></div><div class="textLayer"></div>`,
        ],
        { type: "text/html" },
      ),
    );
    return { src, onZoom: ({ doc, scale }: { doc: Document; scale: number }) => render(pageNumber, doc, scale) };
  };

  const makeTocItem = (item: OutlineItem): TocItem => ({
    label: item.title,
    href: JSON.stringify(item.dest),
    subitems: item.items.length ? item.items.map(makeTocItem) : null,
  });
  const pageIndexOf = async (href: string) => {
    const parsed = JSON.parse(href);
    const dest = typeof parsed === "string" ? await pdf.getDestination(parsed) : parsed;
    return pdf.getPageIndex(dest[0]);
  };

  const { info } = ((await pdf.getMetadata().catch(() => null)) ?? {}) as { info?: { Title?: string; Author?: string } };
  const outline = ((await pdf.getOutline()) ?? []) as OutlineItem[];
  const cache = new Map<number, Awaited<ReturnType<typeof pageDoc>>>();

  return {
    // One centred page at a time (no two-page spreads).
    rendition: { layout: "pre-paginated", spread: "none" },
    metadata: { title: info?.Title, author: info?.Author },
    toc: outline.map(makeTocItem),
    sections: Array.from({ length: pdf.numPages }, (_, i) => ({
      id: i,
      size: 1000,
      load: async () => {
        if (!cache.has(i)) cache.set(i, await pageDoc(i + 1));
        return cache.get(i)!;
      },
    })),
    isExternal: (uri: string) => /^\w+:/i.test(uri),
    resolveHref: async (href: string) => ({ index: await pageIndexOf(href) }),
    splitTOCHref: async (href: string) => [await pageIndexOf(href), null],
    getTOCFragment: (doc: Document) => doc.documentElement,
    destroy: () => {
      // No new drawing ahead; one under way is cancelled by pdf.js's own clean-up.
      closed = true;
      return task.destroy();
    },
  };
}
