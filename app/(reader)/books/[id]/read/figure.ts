/**
 * Tap a picture to see it full screen (M41 R2, "later": a paper's figures are often too small to read in the column).
 * A page's elements live in the book's own frame, so they come from another window: nothing here uses `instanceof`.
 */
export type Figure = { src: string; alt: string; legend: string };

/** Smaller than this on the page (an icon, a decorative rule), a picture is not offered full screen. */
export const MIN_FIGURE_PX = 48;

/** A figure's legend in a paper: the paragraph after it, when it begins "Figure 3", "Fig. 3", "Table 2" or "Plate 1". */
const LEGEND = /^\s*(fig(ure)?s?\.?|table|plate|scheme|chart)\s*[A-Z]?\d/i;

type El = { nodeName: string; closest(sel: string): El | null; textContent: string | null; nextElementSibling: El | null; querySelector(sel: string): El | null };
type Img = El & { currentSrc: string; src: string; alt: string; getBoundingClientRect(): { width: number; height: number } };

/** The picture a tap on the page asks to see full screen, with its legend; null for anything else (a link's picture too). */
export function figureAt(target: unknown): Figure | null {
  const el = target as Partial<El> | null;
  if (!el || typeof el.closest !== "function") return null;
  const img = el.closest("img") as Img | null;
  if (!img || img.closest("a")) return null;
  const src = img.currentSrc || img.src;
  if (!src) return null;
  const box = img.getBoundingClientRect();
  if (box.width < MIN_FIGURE_PX && box.height < MIN_FIGURE_PX) return null;
  return { src, alt: img.alt ?? "", legend: legendOf(img) };
}

function legendOf(img: El): string {
  const caption = img.closest("figure")?.querySelector("figcaption")?.textContent;
  if (caption?.trim()) return tidy(caption);
  // A Markdown paper's figure (markdown-epub.ts): <p class="figure"><img></p>, and the legend in the next paragraph.
  const holder = img.closest("p, div");
  const next = holder?.nextElementSibling?.textContent ?? "";
  return LEGEND.test(next) ? tidy(next) : "";
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
