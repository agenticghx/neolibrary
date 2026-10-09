/**
 * Plays the Spine fold over a PDF spread. The pages on screen are copied to
 * pictures, because the real text layer cannot bend. When the fold ends the
 * pictures are removed and the real pages are back.
 */
import { SPINE_H, SPINE_W, spinePoint } from "./spine";

const STRIPS = 56;
const FOLD_MS = 540;

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

function blankLike(sample: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = sample.width;
  canvas.height = sample.height;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

function place(rect: DOMRect, gutterOnLeft: boolean, t: number) {
  return gutterOnLeft ? rect.left + t * rect.width : rect.right - t * rect.width;
}

/** Draw one spread at progress p. t = 0 is the gutter and t = 1 is the outer edge. */
function paint(canvas: HTMLCanvasElement, p: number, turning: DOMRect, stay: DOMRect, front: HTMLCanvasElement, back: HTMLCanvasElement, under: HTMLCanvasElement, stayImg: HTMLCanvasElement) {
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
    context.fillStyle = "#fff";
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
    context.fillStyle = `rgba(36, 50, 57, ${0.16 * life})`;
    context.fillRect(outward > 0 ? lx - shade : lx, ly, shade, turning.height);
    context.fillStyle = `rgba(255, 255, 255, ${0.95 * life})`;
    context.fillRect(outward > 0 ? lx - edge : lx, ly, edge, turning.height);
    const shadow = context.createLinearGradient(lx, ly, lx + outward * band, ly);
    shadow.addColorStop(0, `rgba(36, 50, 57, ${0.34 * life})`);
    shadow.addColorStop(1, "rgba(36, 50, 57, 0)");
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
    const front = liveCopy(turning.doc) ?? (await book.picture(turning.index, turning.rect.width));
    const stayImg = liveCopy(stay.doc) ?? (await book.picture(stay.index, stay.rect.width));
    const back = await book.picture(backIndex, turning.rect.width);
    if (!front || !stayImg || !back) {
      await go();
      return;
    }
    const under =
      underIndex >= 0 && underIndex < book.pageCount ? ((await book.picture(underIndex, turning.rect.width)) ?? blankLike(front)) : blankLike(front);
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
        paint(canvas, p, turningRect, stayRect, front, back, under, stayImg);
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
