import { rangeForOffsets } from "@/lib/reader/text-range";
import type { XrayMark } from "@/lib/library/xray";

/**
 * X-ray marks on the page (M32 X2). A mark is the first mention of a name in a
 * paragraph; it is drawn as a dotted underline on foliate's overlay (the SVG
 * that draws highlights), keyed "xray:<entry>:<paragraph>:<offset>", so a tap
 * on it comes back through foliate's own "show-annotation" event. The
 * overlay redraws the stored ranges itself after a resize.
 */
export const XRAY_KEY = "xray:";

export type DrawnMark = { key: string; entryId: string; name: string; range: Range };

type Overlayer = { add(key: string, range: Range, draw: (rects: DOMRect[], opts?: unknown) => SVGElement, opts?: unknown): void; remove(key: string): void };
type ViewLike = {
  renderer: { getContents(): { doc: Document; index: number; overlayer?: Overlayer }[] };
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
};

/** A dotted line under each rect of the range, in the given colour: quiet, and clearly not a highlight. */
export function dottedUnderline(color: string) {
  return (rects: DOMRect[]) => {
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    g.setAttribute("data-xray", "");
    for (const r of rects) {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(r.left));
      line.setAttribute("x2", String(r.right));
      line.setAttribute("y1", String(r.bottom - 1));
      line.setAttribute("y2", String(r.bottom - 1));
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-dasharray", "2 3");
      line.setAttribute("stroke-linecap", "round");
      g.append(line);
    }
    return g as unknown as SVGElement;
  };
}

export const markKey = (m: XrayMark) => `${XRAY_KEY}${m.entryId}:${m.sectionId}:${m.start}`;

/** The entry a mark's key names, or null for any other overlay key. */
export function entryOfKey(key: string): string | null {
  if (!key.startsWith(XRAY_KEY)) return null;
  return key.slice(XRAY_KEY.length).split(":")[0] || null;
}

/**
 * Draws a chapter's marks on its overlay. Each paragraph's address resolves to
 * its element; the offsets into the stored text become a range, the way a
 * spoken word is lit. Marks whose text cannot be found (a chapter still
 * opening, or text the file renders differently) are skipped.
 */
export function drawMarks(view: ViewLike, index: number, marks: XrayMark[], color: string): DrawnMark[] {
  const content = view.renderer.getContents().find((c) => c.index === index);
  const overlayer = content?.overlayer;
  if (!content?.doc || !overlayer) return [];
  const draw = dottedUnderline(color);
  const out: DrawnMark[] = [];
  const byCfi = new Map<string, Element | null>();
  for (const m of marks) {
    let el = byCfi.get(m.cfi);
    if (el === undefined) {
      try {
        const start = view.resolveCFI(m.cfi).anchor(content.doc).startContainer;
        el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
      } catch {
        el = null;
      }
      byCfi.set(m.cfi, el);
    }
    if (!el) continue;
    const range = rangeForOffsets(el, m.start, m.end);
    if (!range) continue;
    const key = markKey(m);
    overlayer.add(key, range, draw);
    out.push({ key, entryId: m.entryId, name: m.name, range });
  }
  return out;
}

/** The names whose marks lie inside what is on screen, in reading order, each once. */
export function namesOnScreen(drawn: DrawnMark[], visible: Range | null | undefined): { id: string; name: string }[] {
  if (!visible) return [];
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const m of drawn) {
    if (m.range.startContainer.ownerDocument !== visible.startContainer.ownerDocument) continue;
    const before = m.range.compareBoundaryPoints(Range.START_TO_END, visible) <= 0; // ends before the screen starts
    const after = m.range.compareBoundaryPoints(Range.END_TO_START, visible) >= 0; // starts after the screen ends
    if (before || after || seen.has(m.entryId)) continue;
    seen.add(m.entryId);
    out.push({ id: m.entryId, name: m.name });
  }
  return out;
}
