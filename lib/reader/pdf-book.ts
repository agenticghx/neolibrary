/**
 * Turns a PDF into a "book" object that foliate-js's fixed-layout renderer can
 * show: one section per page, each page drawn on a canvas with a transparent
 * text layer on top (so text can be selected and, later, highlighted).
 * Adapted from foliate-js's pdf.js adapter (MIT, John Factotum), which is not
 * in its npm release; uses pdfjs-dist (Apache-2.0).
 */
type Pdfjs = typeof import("pdfjs-dist");

// From pdf.js's text_layer_builder.css: invisible, selectable text over the canvas.
const TEXT_LAYER_CSS = `
.textLayer { position: absolute; text-align: initial; inset: 0; overflow: clip; opacity: 1; line-height: 1;
  text-size-adjust: none; forced-color-adjust: none; transform-origin: 0 0; caret-color: CanvasText; z-index: 0; }
.textLayer :is(span, br) { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; }
.textLayer > :not(.markedContent), .textLayer .markedContent span:not(.markedContent) { z-index: 1; }
.textLayer span.markedContent { top: 0; height: 0; }
.textLayer ::selection { background: rgb(55 105 99 / 0.3); }
.textLayer br::selection { background: transparent; }
.textLayer .endOfContent { display: block; position: absolute; inset: 100% 0 0; z-index: 0; cursor: default; user-select: none; }
`;

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

  const render = async (pageNumber: number, doc: Document, zoom: number) => {
    const page = await pdf.getPage(pageNumber);
    const scale = zoom * devicePixelRatio;
    doc.documentElement.style.transform = `scale(${1 / devicePixelRatio})`;
    doc.documentElement.style.transformOrigin = "top left";
    doc.documentElement.style.setProperty("--scale-factor", String(scale));
    const viewport = page.getViewport({ scale });
    // The canvas must belong to this document (pdf.js loads fonts here), then moves into the page frame.
    const canvas = document.createElement("canvas");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    doc.querySelector("#canvas")!.replaceChildren(doc.adoptNode(canvas));
    const container = doc.querySelector(".textLayer") as HTMLElement;
    container.replaceChildren();
    await new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container, viewport }).render();
    const end = doc.createElement("div");
    end.className = "endOfContent";
    container.append(end);
  };

  const pageDoc = async (pageNumber: number) => {
    const viewport = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 });
    const src = URL.createObjectURL(
      new Blob(
        [
          `<!DOCTYPE html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
<style>html, body { margin: 0; padding: 0; }
:root { --user-unit: 1; --total-scale-factor: calc(var(--scale-factor) * var(--user-unit)); --scale-round-x: 1px; --scale-round-y: 1px; }
${TEXT_LAYER_CSS}</style>
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
    destroy: () => task.destroy(),
  };
}
