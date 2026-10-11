/**
 * Plays the Spine fold over a PDF spread. The pages on screen are copied to
 * pictures, because the real text layer cannot bend. When the fold ends the
 * pictures are removed and the real pages are back.
 */
import { SPINE_H, SPINE_W, spinePoint } from "./spine";

const STRIPS = 56;
const FOLD_MS = 540;

// Dimmed pages (M19 P2): the pages on screen are dimmed by a CSS filter on their picture (DIM_CSS in pdf-book.ts),
// which a copy of their pixels does not carry. So the fold dims its own pictures the same way, and paints the
// paper the colour a dimmed white page has; without this the turning sheet flashed white at night.
const DIM_FILTER = "invert(0.88) hue-rotate(180deg)";
const DIM_PAPER = "rgb(31, 31, 31)";

/** How the fold paints: the paper under a picture, and the crease's bright edge and shadow. */
type Look = { paper: string; edge: number; shadow: string; shadowAlpha: number };
const PRINTED: Look = { paper: "#fff", edge: 0.95, shadow: "36, 50, 57", shadowAlpha: 1 };
const DIMMED: Look = { paper: DIM_PAPER, edge: 0.3, shadow: "0, 0, 0", shadowAlpha: 1.6 };

export type SpineView = HTMLElement & {
  next(): Promise<void>;
  prev(): Promise<void>;
  renderer?: { getContents(): { doc: Document }[] };
};

export type SpineBook = {
  pageCount: number;
  picture(index: number, cssWidth: number): Promise<HTMLCanvasElement | null>;
};

type Side = { doc: Document; rect: DOMRect; index: number };

let folding = false;

function pageIndex(doc: Document) {
  const n = Number(doc.documentElement.dataset.page);
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

function hostBox(doc: Document) {
  const frame = doc.defaultView?.frameElement as HTMLElement | null;
  const host = frame?.parentElement;
  if (!host) return null;
  const rect = host.getBoundingClientRect();
  if (getComputedStyle(host).display === "none" || rect.width <= 2 || rect.height <= 2) return null;
  return rect;
}

/** The two PDF pages facing the reader, left then right. Null when one page is showing. */
export function pdfSpread(view: SpineView): { left: Side; right: Side } | null {
  const sides: Side[] = [];
  for (const item of view.renderer?.getContents() ?? []) {
    const doc = item.doc;
    if (!doc) continue;
    const rect = hostBox(doc);
    const index = pageIndex(doc);
    if (!rect || index < 0) continue;
    sides.push({ doc, rect, index });
  }
  if (sides.length !== 2) return null;
  sides.sort((a, b) => a.rect.left - b.rect.left);
  return { left: sides[0]!, right: sides[1]! };
}

function liveCopy(doc: Document) {
  const node = doc.querySelector("#canvas canvas");
  if (!(node instanceof HTMLCanvasElement) || node.width < 2 || node.height < 2) return null;
  const copy = document.createElement("canvas");
  copy.width = node.width;
  copy.height = node.height;
  const context = copy.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(node, 0, 0);
  } catch {
    return null;
  }
  return copy;
}

function blankLike(sample: HTMLCanvasElement, paper: string) {
  const canvas = document.createElement("canvas");
  canvas.width = sample.width;
  canvas.height = sample.height;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/**
 * DIM_FILTER worked out by hand, for a browser whose canvas cannot draw through a filter: invert(0.88) takes each
 * channel c to 0.88 * 255 + (1 - 2 * 0.88) * c, then hue-rotate(180deg) is the Filter Effects colour matrix.
 * Uint8ClampedArray rounds and clamps.
 */
export function dimPixels(px: Uint8ClampedArray) {
  for (let i = 0; i < px.length; i += 4) {
    const r = 224.4 - 0.76 * px[i]!;
    const g = 224.4 - 0.76 * px[i + 1]!;
    const b = 224.4 - 0.76 * px[i + 2]!;
    px[i] = -0.574 * r + 1.43 * g + 0.144 * b;
    px[i + 1] = 0.426 * r + 0.43 * g + 0.144 * b;
    px[i + 2] = 0.426 * r + 1.43 * g - 0.856 * b;
  }
}

let filterWorks: boolean | null = null;
/** Whether a canvas here draws through a CSS filter (Safari before 18 ignores it): a white pixel drawn inverted. */
function canvasFilters() {
  if (document.documentElement.dataset.spineNoFilter) return false; // a test takes the by-hand path; production never sets it
  if (filterWorks !== null) return filterWorks;
  const white = document.createElement("canvas");
  const probe = document.createElement("canvas");
  white.width = white.height = probe.width = probe.height = 1;
  const w = white.getContext("2d");
  const p = probe.getContext("2d", { willReadFrequently: true });
  if (!w || !p) return (filterWorks = false);
  w.fillStyle = "#fff";
  w.fillRect(0, 0, 1, 1);
  p.filter = "invert(1)";
  p.drawImage(white, 0, 0);
  return (filterWorks = p.getImageData(0, 0, 1, 1).data[0]! < 128);
}

/** A page picture as the dimmed page on screen shows it. */
function dimmed(img: HTMLCanvasElement) {
  const out = document.createElement("canvas");
  out.width = img.width;
  out.height = img.height;
  const context = out.getContext("2d", { willReadFrequently: !canvasFilters() });
  if (!context) return img;
  if (canvasFilters()) {
    context.filter = DIM_FILTER;
    context.drawImage(img, 0, 0);
    return out;
  }
  context.drawImage(img, 0, 0);
  const data = context.getImageData(0, 0, out.width, out.height);
  dimPixels(data.data);
  context.putImageData(data, 0, 0);
  return out;
}

function place(rect: DOMRect, gutterOnLeft: boolean, t: number) {
  return gutterOnLeft ? rect.left + t * rect.width : rect.right - t * rect.width;
}

/** Draw one spread at progress p. t = 0 is the gutter and t = 1 is the outer edge. */
function paint(canvas: HTMLCanvasElement, p: number, turning: DOMRect, stay: DOMRect, front: HTMLCanvasElement, back: HTMLCanvasElement, under: HTMLCanvasElement, stayImg: HTMLCanvasElement, look: Look) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  const bounds = new DOMRect(
    Math.min(turning.left, stay.left),
    Math.min(turning.top, stay.top),
    Math.max(turning.right, stay.right) - Math.min(turning.left, stay.left),
    Math.max(turning.bottom, stay.bottom) - Math.min(turning.top, stay.top),
  );
  canvas.style.left = `${bounds.left}px`;
  canvas.style.top = `${bounds.top}px`;
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;
  canvas.width = Math.max(1, Math.ceil(bounds.width * ratio));
  canvas.height = Math.max(1, Math.ceil(bounds.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  const gutterOnLeft = stay.right <= turning.left + 1;
  const toLocal = (x: number, y: number) => [x - bounds.left, y - bounds.top] as const;
  // The page picture's left edge is the left of the screen. On a right-hand page that is the gutter.
  const bitmapOf = (sheetT: number) => (gutterOnLeft ? sheetT : 1 - sheetT);

  const fillPage = (rect: DOMRect, img: HTMLCanvasElement) => {
    const [x, y] = toLocal(rect.left, rect.top);
    context.fillStyle = look.paper;
    context.fillRect(x, y, rect.width, rect.height);
    context.drawImage(img, x, y, rect.width, rect.height);
  };
  fillPage(stay, stayImg);
  fillPage(turning, under);

  // destA/srcA is one edge of a strip, destB/srcB the other. src is 0 at the gutter and 1 at the outer edge.
  const strip = (img: HTMLCanvasElement, destA: number, srcA: number, destB: number, srcB: number) => {
    const xA = place(turning, gutterOnLeft, destA);
    const xB = place(turning, gutterOnLeft, destB);
    const dw = Math.abs(xB - xA);
    if (dw < 0.2) return;
    const leftIsA = xA <= xB;
    const ba = bitmapOf(leftIsA ? srcA : srcB);
    const bb = bitmapOf(leftIsA ? srcB : srcA);
    const [dx, dy] = toLocal(Math.min(xA, xB), turning.top);
    // Neighbours overlap by a fraction of a pixel so the sheet has no seams.
    const overlap = 0.75;
    if (ba <= bb) {
      context.drawImage(img, ba * img.width, 0, Math.max(1, (bb - ba) * img.width), img.height, dx - overlap / 2, dy, dw + overlap, turning.height);
    } else {
      context.drawImage(img, bb * img.width, 0, Math.max(1, (ba - bb) * img.width), img.height, dx + dw + overlap / 2, dy, -(dw + overlap), turning.height);
    }
  };

  for (let i = 0; i < STRIPS; i++) {
    const t0 = i / STRIPS;
    const t1 = (i + 1) / STRIPS;
    const point = spinePoint((t0 + t1) / 2, SPINE_H / 2, p);
    if (point.back) continue;
    strip(front, t0, t0, t1, t1);
  }
  for (let i = 0; i < STRIPS; i++) {
    const t0 = i / STRIPS;
    const t1 = (i + 1) / STRIPS;
    const mid = (t0 + t1) / 2;
    const point = spinePoint(mid, SPINE_H / 2, p);
    if (!point.back) continue;
    const dest = point.x / SPINE_W;
    const half = (t1 - t0) / 2;
    // The back of the sheet. The picture is sampled from the other end of the page, as the prototype does
    // (1 - u), so the words read the right way once the page has turned over.
    strip(back, dest - half, 1 - t1, dest + half, 1 - t0);
  }
  // The crease is the bright edge of the bending sheet, with a soft shadow on the page it uncovers.
  // A white line alone disappears on white paper, so the shadow is what the eye follows.
  const life = Math.sin(Math.PI * p);
  if (life > 0.02) {
    const x = place(turning, gutterOnLeft, 1 - p);
    const [lx, ly] = toLocal(x, turning.top);
    const outward = gutterOnLeft ? 1 : -1;
    const shade = turning.width * 0.02;
    const edge = Math.max(1.5, turning.width * 0.006);
    const band = turning.width * 0.05;
    context.fillStyle = `rgba(${look.shadow}, ${0.16 * look.shadowAlpha * life})`;
    context.fillRect(outward > 0 ? lx - shade : lx, ly, shade, turning.height);
    context.fillStyle = `rgba(255, 255, 255, ${look.edge * life})`;
    context.fillRect(outward > 0 ? lx - edge : lx, ly, edge, turning.height);
    const shadow = context.createLinearGradient(lx, ly, lx + outward * band, ly);
    shadow.addColorStop(0, `rgba(${look.shadow}, ${0.34 * look.shadowAlpha * life})`);
    shadow.addColorStop(1, `rgba(${look.shadow}, 0)`);
    context.fillStyle = shadow;
    context.fillRect(outward > 0 ? lx : lx - band, ly, band, turning.height);
  }
}

function prefersStill() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Turn one PDF spread. A fold plays only when two pages are on screen.
 * Otherwise the page changes at once. A fold already playing is left alone.
 */
export async function turnWithSpine(view: SpineView, book: SpineBook | null, direction: "next" | "prev", pdf: boolean) {
  const plain = () => (direction === "next" ? view.next() : view.prev());
  if (folding) return;
  const spread = pdf ? pdfSpread(view) : null;
  if (!pdf || !book || !spread || prefersStill()) return plain();
  const turning = direction === "next" ? spread.right : spread.left;
  const stay = direction === "next" ? spread.left : spread.right;
  const backIndex = direction === "next" ? turning.index + 1 : turning.index - 1;
  const underIndex = direction === "next" ? turning.index + 2 : turning.index - 2;
  if (backIndex < 0 || backIndex >= book.pageCount) return plain();

  folding = true;
  const canvas = document.createElement("canvas");
  canvas.dataset.spineFold = "1";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", pointerEvents: "none", zIndex: "40" });
  let moved = false;
  const go = async () => {
    if (moved) return;
    moved = true;
    await plain();
  };
  try {
    const dim = turning.doc.documentElement.hasAttribute("data-dim");
    const look = dim ? DIMMED : PRINTED;
    const shown = (img: HTMLCanvasElement | null) => (img && dim ? dimmed(img) : img);
    const front = shown(liveCopy(turning.doc) ?? (await book.picture(turning.index, turning.rect.width)));
    const stayImg = shown(liveCopy(stay.doc) ?? (await book.picture(stay.index, stay.rect.width)));
    const back = shown(await book.picture(backIndex, turning.rect.width));
    if (!front || !stayImg || !back) {
      await go();
      return;
    }
    const under =
      (underIndex >= 0 && underIndex < book.pageCount ? shown(await book.picture(underIndex, turning.rect.width)) : null) ??
      blankLike(front, look.paper);
    const turningRect = turning.rect;
    const stayRect = stay.rect;
    view.style.visibility = "hidden";
    document.body.append(canvas);
    await new Promise<void>((resolve) => {
      const started = performance.now();
      const frame = (now: number) => {
        let elapsed = now - started;
        // A test pins the fold at halfway so a picture can be taken. Production never sets this.
        if (document.documentElement.dataset.spineHold === "mid" && elapsed > FOLD_MS / 2) elapsed = FOLD_MS / 2;
        const p = Math.min(1, elapsed / FOLD_MS);
        paint(canvas, p, turningRect, stayRect, front, back, under, stayImg, look);
        if (p < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    await go();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  } catch (err) {
    console.error(err);
    await go();
  } finally {
    canvas.remove();
    view.style.visibility = "";
    folding = false;
  }
}

/** A plain click on a PDF page turns it. A drag that selects words does not. */
export function bindSpineClick(doc: Document, direction: (doc: Document) => "next" | "prev" | null, turn: (dir: "next" | "prev") => void) {
  if (doc.documentElement.dataset.spineClick) return;
  doc.documentElement.dataset.spineClick = "1";
  let down: { x: number; y: number } | null = null;
  doc.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    down = { x: event.clientX, y: event.clientY };
  });
  doc.addEventListener("pointerup", (event) => {
    if (!down || event.button !== 0) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    down = null;
    if (moved > 6) return;
    const selected = doc.getSelection();
    if (selected && !selected.isCollapsed) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("a[href]")) return;
    const dir = direction(doc);
    if (dir) turn(dir);
  });
}
