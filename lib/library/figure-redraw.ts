/**
 * M41 R6: a paper's figure redrawn cleanly, as a drawing (SVG) made from the
 * figure itself and checked against it.
 *
 * Written for Claude sessions and for Samuel. A scanned figure is often blurred
 * and heavy; a redraw has the same boxes, lines, curves, points and words, drawn
 * sharp. It is never a new picture: it is accepted only when it lies over the
 * original (the checks below), and the original is always one tap away.
 *
 * The redrawing runs on the laptop with `claude -p` on Samuel's subscription
 * (scripts/figures-on-subscription.ts): two independent readings of the
 * figure's words must agree, then a drawing is made, drawn into pixels and
 * compared with the figure. Only a redraw that passes every check is sent to the
 * site (POST /api/agent/books/<id>/figure-redraws), where it is a `generations`
 * row (kind "figure-redraw") with its provenance; no new table.
 *
 * Safety: book files may not carry SVG (an SVG file can hold code), so a redraw
 * is checked against a short list of drawing elements and attributes here,
 * again on the server, and is shown only as a picture (<img>), where a browser
 * runs no code in it.
 */
import { posix } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { DOMParser } from "linkedom";

export const REDRAW_KIND = "figure-redraw";
export const TRANSCRIBE_PROMPT = "figure-transcribe";
export const REDRAW_PROMPT = "figure-redraw";
/** A redraw larger than this is not a clean line drawing. */
export const MAX_SVG_CHARS = 400_000;

export class FigureError extends Error {}

const ELEMENTS = new Set(["svg", "g", "rect", "line", "polyline", "polygon", "path", "circle", "ellipse", "text", "tspan", "defs", "marker", "title", "desc"]);
const ATTRIBUTES = new Set([
  "xmlns", "version", "viewBox", "width", "height", "preserveAspectRatio", "id",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "dx", "dy", "rotate", "transform",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "opacity", "vector-effect",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "alignment-baseline",
  "baseline-shift", "letter-spacing", "xml:space", "textLength", "lengthAdjust",
  "marker-start", "marker-mid", "marker-end", "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "orient",
]);
const SVG_NS = "http://www.w3.org/2000/svg";

export type Spot = { chapter: string; nth: number };
export type Found = { key: string; src: string; alt: string; spots: Spot[]; bytes: Uint8Array };

/** Every picture in the book's pages, in reading order, with where it appears (chapter file, and its place among the chapter's pictures). */
export function figuresOf(epub: Uint8Array): Found[] {
  const files = unzipSync(epub);
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : "");
  const opfPath = /full-path="([^"]+)"/.exec(text("META-INF/container.xml"))?.[1];
  if (!opfPath) throw new Error("Not an EPUB: no package file named in META-INF/container.xml.");
  const opf = new DOMParser().parseFromString(text(opfPath), "text/xml");
  const dir = posix.dirname(opfPath);
  const href = new Map<string, string>();
  for (const item of Array.from(opf.querySelectorAll("manifest > item") as unknown as ArrayLike<Element>)) href.set(item.getAttribute("id") ?? "", posix.normalize(posix.join(dir, decodeURI(item.getAttribute("href") ?? ""))));
  const found = new Map<string, Found>();
  for (const ref of Array.from(opf.querySelectorAll("spine > itemref") as unknown as ArrayLike<Element>)) {
    const chapter = href.get(ref.getAttribute("idref") ?? "");
    if (!chapter || !files[chapter]) continue;
    const doc = new DOMParser().parseFromString(text(chapter), "text/html");
    Array.from(doc.querySelectorAll("img") as unknown as ArrayLike<Element>).forEach((img, nth) => {
      const raw = img.getAttribute("src") ?? "";
      if (!raw || /^[a-z]+:/i.test(raw)) return;
      const src = posix.normalize(posix.join(posix.dirname(chapter), decodeURI(raw)));
      const bytes = files[src];
      if (!bytes) return;
      const f = found.get(src) ?? { key: posix.basename(src).replace(/\.[^.]+$/, ""), src, alt: img.getAttribute("alt") ?? "", spots: [], bytes };
      f.spots.push({ chapter, nth });
      found.set(src, f);
    });
  }
  return [...found.values()];
}

const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");

/**
 * The redraw as given, if it holds only plain drawing: the elements and
 * attributes listed above, no addresses but links inside the drawing
 * (`url(#arrow)`), no scripts, styles, pictures or events. Throws FigureError
 * saying what is not allowed. Nothing is rewritten: a drawing either passes
 * whole or is refused.
 */
export function checkSvg(svg: string): string {
  const s = svg.trim();
  if (s.length > MAX_SVG_CHARS) throw new FigureError(`The drawing is too large (${s.length} characters).`);
  if (/<!(DOCTYPE|ENTITY)|<!\[CDATA\[/i.test(s)) throw new FigureError("The drawing declares a document type, entities or CDATA.");
  if (/<\?(?!xml\s)/.test(s)) throw new FigureError("The drawing holds a processing instruction.");
  if (!/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(s) || !/<\/svg>$/.test(s)) throw new FigureError("The drawing must be one <svg> element.");
  if ((s.match(/<svg[\s>]/g) ?? []).length !== 1 || (s.match(/<\/svg>/g) ?? []).length !== 1) throw new FigureError("The drawing must be one <svg> element, with nothing after it.");
  const doc = parse(s);
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg" || root.getAttribute("xmlns") !== SVG_NS) throw new FigureError("The drawing must be an <svg> in the SVG namespace.");
  if (!/^\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+\s*$/.test(root.getAttribute("viewBox") ?? "")) throw new FigureError("The drawing has no viewBox.");
  for (const el of [root, ...Array.from(root.querySelectorAll("*") as unknown as ArrayLike<Element>)]) {
    const name = el.tagName;
    if (!ELEMENTS.has(name)) throw new FigureError(`The drawing uses <${name}>, which is not allowed.`);
    for (const a of Array.from(el.attributes) as Attr[]) {
      if (!ATTRIBUTES.has(a.name)) throw new FigureError(`The drawing uses the attribute ${a.name} on <${name}>, which is not allowed.`);
      const v = a.value;
      if (/url\s*\(/i.test(v) && !/^url\(#[\w-]+\)$/.test(v.trim())) throw new FigureError(`The attribute ${a.name} points outside the drawing.`);
      if (/javascript:|expression\s*\(|[<>]/i.test(v)) throw new FigureError(`The attribute ${a.name} holds code.`);
    }
  }
  return s;
}

/** Each <text> element's words, its <tspan>s joined, in order. */
export function svgTexts(svg: string): string[] {
  const doc = parse(svg);
  return Array.from(doc.querySelectorAll("text") as unknown as ArrayLike<Element>)
    .map((t) => (t.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The words of some lines of text: runs of letters and digits, capitals kept ("E_max" and "Emax" differ; write formulas one way). */
export const wordsOf = (lines: string[]) => lines.join(" ").normalize("NFC").match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Two readings of a figure's words agree, and a redraw uses exactly the words read, when they have the same words,
 * counted, capitals included: "Interaction" and "interaction" differ. Spacing, punctuation and how a formula is laid
 * out (a stacked fraction, a raised m or ^m) do not count.
 */
export function wordDiff(want: string[], got: string[]) {
  const count = (lines: string[]) => {
    const m = new Map<string, number>();
    for (const w of wordsOf(lines)) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const a = count(want);
  const b = count(got);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [w, n] of a) for (let k = b.get(w) ?? 0; k < n; k++) missing.push(w);
  for (const [w, n] of b) for (let k = a.get(w) ?? 0; k < n; k++) extra.push(w);
  return { missing, extra, same: missing.length === 0 && extra.length === 0 };
}

/** The drawing with only its k-th <text> (to find where each line of words sits). */
export function onlyWord(svg: string, k: number): string {
  const doc = parse(svg);
  for (const el of Array.from(doc.querySelectorAll("rect, line, polyline, polygon, path, circle, ellipse, marker") as unknown as ArrayLike<Element>)) el.remove();
  Array.from(doc.querySelectorAll("text") as unknown as ArrayLike<Element>).forEach((t, i) => i !== k && t.remove());
  return doc.toString();
}

/** The drawing with only its words (lines, shapes and markers taken out), and with everything but its words. */
export function splitSvg(svg: string): { words: string; lines: string } {
  const words = parse(svg);
  for (const el of Array.from(words.querySelectorAll("rect, line, polyline, polygon, path, circle, ellipse, marker") as unknown as ArrayLike<Element>)) el.remove();
  const lines = parse(svg);
  for (const el of Array.from(lines.querySelectorAll("text") as unknown as ArrayLike<Element>)) el.remove();
  return { words: words.toString(), lines: lines.toString() };
}

// --- Pixels: does the drawing lie over the figure? ---------------------------------------------------------------

/** 1 where a pixel is ink (dark), from RGBA bytes. */
export function inkOf(rgba: ArrayLike<number>, w: number, h: number, threshold = 150): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const lum = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a);
    out[i] = lum < threshold ? 1 : 0;
  }
  return out;
}

/** Thins ink to lines one pixel wide (Zhang and Suen, 1984), so a heavy stroke and a fine one compare alike. */
export function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const m = Uint8Array.from(mask);
  for (let x = 0; x < w; x++) m[x] = m[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) m[y * w] = m[y * w + w - 1] = 0;
  const gone: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const step of [0, 1]) {
      gone.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!m[i]) continue;
          const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1], p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) a++;
          if (a !== 1) continue;
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          gone.push(i);
        }
      }
      for (const i of gone) m[i] = 0;
      if (gone.length) changed = true;
    }
  }
  return m;
}

/** Distance in pixels from each pixel to the nearest ink (chamfer 3-4, close to straight-line distance). */
export function distances(mask: Uint8Array, w: number, h: number): Float32Array {
  const far = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 0 : far;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 3);
      if (y > 0) {
        d[i] = Math.min(d[i], d[i - w] + 3);
        if (x > 0) d[i] = Math.min(d[i], d[i - w - 1] + 4);
        if (x < w - 1) d[i] = Math.min(d[i], d[i - w + 1] + 4);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) d[i] = Math.min(d[i], d[i + 1] + 3);
      if (y < h - 1) {
        d[i] = Math.min(d[i], d[i + w] + 3);
        if (x < w - 1) d[i] = Math.min(d[i], d[i + w + 1] + 4);
        if (x > 0) d[i] = Math.min(d[i], d[i + w - 1] + 4);
      }
    }
  }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

/** The share of `ink` pixels farther than `limit` from the ink whose distances are `d`. */
function shareFar(ink: Uint8Array, d: Float32Array, limit: number) {
  let all = 0;
  let far = 0;
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    all++;
    if (d[i] > limit) far++;
  }
  return { share: all ? far / all : 0, all, far };
}

/** How far a redraw may stray: 0.4 % of the figure's longer side, at least 3 pixels. */
export const toleranceFor = (w: number, h: number) => Math.max(3, Math.round(0.004 * Math.max(w, h)));

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Where a mask has ink, as a box (null if none). */
export function boxOf(mask: Uint8Array, w: number, h: number): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Where the figure's lettering is taken to be: each line of the redraw's words, widened by a third of its width on
 * each side and a quarter of its height (the paper's type is often heavier and wider than the redraw's), plus the
 * tolerance. The figure's ink there is compared as words, not as lines.
 */
export function wordZone(boxes: Box[], w: number, h: number, t: number): Uint8Array {
  const zone = new Uint8Array(w * h);
  for (const b of boxes) {
    const dx = Math.round((b.x1 - b.x0 + 1) / 3) + t;
    const dy = Math.round((b.y1 - b.y0 + 1) / 4) + t;
    for (let y = Math.max(0, b.y0 - dy); y <= Math.min(h - 1, b.y1 + dy); y++) zone.fill(1, y * w + Math.max(0, b.x0 - dx), y * w + Math.min(w - 1, b.x1 + dx) + 1);
  }
  return zone;
}

/** Ink smaller than this, touching nothing, is a speck of the scan, not part of the figure. */
export const SPECK = 12;

/** The pieces of ink (touching pixels, diagonals included): for each ink pixel its piece's number, and each piece's size and box. */
export function inkPieces(mask: Uint8Array, w: number, h: number): { of: Int32Array; size: number[]; box: Box[] } {
  const of = new Int32Array(w * h).fill(-1);
  const size: number[] = [];
  const box: Box[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || of[start] >= 0) continue;
    const id = size.length;
    const b = { x0: w, y0: h, x1: -1, y1: -1 };
    let n = 0;
    const stack = [start];
    of[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      const x = i % w;
      const y = (i - x) / w;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      for (const j of [i - w - 1, i - w, i - w + 1, i - 1, i + 1, i + w - 1, i + w, i + w + 1]) {
        if (j < 0 || j >= w * h || Math.abs((j % w) - x) > 1 || !mask[j] || of[j] >= 0) continue;
        of[j] = id;
        stack.push(j);
      }
    }
    size.push(n);
    box.push(b);
  }
  return { of, size, box };
}

/** The limits a redraw must keep to (shares of line pixels, measured on lines thinned to one pixel). */
export const LIMITS = { missed: 0.04, extra: 0.03, wordsAstray: 0.05, missedPieces: 0, extraPieces: 0 };

/**
 * Pieces of a mask: runs of touching pixels at least `min` long, each with where it is (its centre). A tick mark or a
 * data point the redraw lacks is a piece, however small a share of the figure it is.
 */
export type Piece = { x: number; y: number; size: number; at: number };
export function pieces(mask: Uint8Array, w: number, h: number, min: number): Piece[] {
  const seen = new Uint8Array(w * h);
  const out: Piece[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0, sx = 0, sy = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      size++;
      sx += x;
      sy += y;
      // Touching within two pixels: a thinned line broken by a speck stays one piece.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (size >= min) out.push({ x: Math.round(sx / size), y: Math.round(sy / size), size, at: start });
  }
  return out;
}

export type InkCheck = {
  tolerance: number;
  /** The figure's lines (outside its words) that the redraw does not have nearby. */
  missed: number;
  /** The redraw's lines that the figure does not have nearby: something added or moved. */
  extra: number;
  /** The redraw's words where the figure has no ink: a word put in the wrong place. */
  wordsAstray: number;
  /** Pieces of the figure the redraw lacks, and pieces the redraw adds (see `pieces`). */
  missedPieces: Piece[];
  extraPieces: Piece[];
  /** Where each kind of difference is, for a picture of the check. */
  marks: { missed: Uint8Array; extra: Uint8Array; astray: Uint8Array };
  pass: boolean;
  reasons: string[];
};

/**
 * Compares the figure with its redraw, drawn into pixels at the figure's size
 * twice: its lines alone and its words alone. Words are compared as text
 * elsewhere (`tokenDiff`), so here the figure's lettering is set aside where the
 * redraw has words, and only the lines, curves and points are compared, both
 * ways, after thinning both to one pixel.
 */
export function compareInk(input: { figure: Uint8Array; lines: Uint8Array; words: Uint8Array; wordBoxes: Box[]; w: number; h: number }): InkCheck {
  const { figure, lines, words, wordBoxes, w, h } = input;
  const t = toleranceFor(w, h);
  const zone = wordZone(wordBoxes, w, h, t);
  const figureLines = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) figureLines[i] = figure[i] && !zone[i] ? 1 : 0;
  const thinFigure = thin(figureLines, w, h);
  const thinLines = thin(lines, w, h);
  const thinWords = thin(words, w, h);
  const toLines = distances(lines, w, h);
  const toFigure = distances(figure, w, h);
  const missed = shareFar(thinFigure, toLines, t);
  const extra = shareFar(thinLines, toFigure, t);
  const astray = shareFar(thinWords, toFigure, 2 * t);
  const mark = (ink: Uint8Array, d: Float32Array, limit: number) => ink.map((v, i) => (v && d[i] > limit ? 1 : 0));
  const marks = { missed: mark(thinFigure, toLines, t), extra: mark(thinLines, toFigure, t), astray: mark(thinWords, toFigure, 2 * t) };
  // A missing piece counts from 3 pixels (a tick mark sticks out only a few pixels past its axis), unless it is a
  // speck of dust (ink in the figure smaller than SPECK pixels, touching nothing) or lettering: a loose piece of the
  // figure's ink no taller than a line of the redraw's words, beside one (the paper's type is often wider, so a
  // word's end can stick out past the redraw's). A tick is joined to its axis, so it is never taken for lettering.
  const ink = inkPieces(figure, w, h);
  const lettering = (at: number) => {
    const id = ink.of[at];
    if (id < 0) return false;
    const piece = ink.box[id];
    const x = at % w;
    const y = (at - x) / w;
    return wordBoxes.some((b) => {
      const lineH = b.y1 - b.y0 + 1;
      const dx = Math.round(0.6 * (b.x1 - b.x0 + 1)) + 2 * t;
      return x >= b.x0 - dx && x <= b.x1 + dx && y >= b.y0 - lineH && y <= b.y1 + lineH && piece.y1 - piece.y0 + 1 <= 1.6 * lineH + t;
    });
  };
  const missedPieces = pieces(marks.missed, w, h, 3).filter((p) => (ink.size[ink.of[p.at]] ?? 0) >= SPECK && !lettering(p.at));
  const extraPieces = pieces(marks.extra, w, h, 2 * t + 2);
  const at = (ps: { x: number; y: number }[]) => ps.slice(0, 12).map((p) => `(${p.x}, ${p.y})`).join(", ") + (ps.length > 12 ? ", …" : "");
  const reasons: string[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  if (missed.share > LIMITS.missed) reasons.push(`${pct(missed.share)} of the figure's lines are not in the redraw (limit ${pct(LIMITS.missed)})`);
  if (extra.share > LIMITS.extra) reasons.push(`${pct(extra.share)} of the redraw's lines are not in the figure (limit ${pct(LIMITS.extra)})`);
  if (astray.share > LIMITS.wordsAstray) reasons.push(`${pct(astray.share)} of the redraw's words sit where the figure has none (limit ${pct(LIMITS.wordsAstray)})`);
  if (missedPieces.length > LIMITS.missedPieces) reasons.push(`${missedPieces.length} pieces of the figure (a line, tick, bracket or point) are missing from the redraw, near ${at(missedPieces)}`);
  if (extraPieces.length > LIMITS.extraPieces) reasons.push(`${extraPieces.length} pieces of the redraw are not in the figure, near ${at(extraPieces)}`);
  if (!thinLines.some(Boolean) && thinFigure.some(Boolean)) reasons.push("the redraw has no lines");
  return {
    tolerance: t,
    missed: missed.share,
    extra: extra.share,
    wordsAstray: astray.share,
    missedPieces,
    extraPieces,
    marks,
    pass: reasons.length === 0,
    reasons,
  };
}
