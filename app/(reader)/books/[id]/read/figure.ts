/**
 * Tap a picture to see it full screen (M41 R2, "later": a paper's figures are often too small to read in the column).
 * A page's elements live in the book's own frame, so they come from another window: nothing here uses `instanceof`.
 */
export type Figure = {
  src: string;
  alt: string;
  legend: string;
  /** M41 R6: for a redrawn figure, both pictures' addresses and the model that redrew it (figure-redraws.ts). */
  redraw?: { printed: string; redrawn: string; model: string };
};

/** Smaller than this on the page (an icon, a decorative rule), a picture is not offered full screen. */
export const MIN_FIGURE_PX = 48;

/** A figure's legend in a paper: the paragraph after it, when it begins "Figure 3", "Fig. 3", "Table 2" or "Plate 1". */
const LEGEND = /^\s*(fig(ure)?s?\.?|table|plate|scheme|chart)\s*[A-Z]?\d/i;

type El = { nodeName: string; closest(sel: string): El | null; textContent: string | null; nextElementSibling: El | null; querySelector(sel: string): El | null };
type Img = El & { currentSrc: string; src: string; alt: string; dataset?: DOMStringMap; getBoundingClientRect(): { width: number; height: number } };

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
  const d = img.dataset;
  const redraw = d?.nlRedraw && d.nlPrinted ? { printed: d.nlPrinted, redrawn: d.nlRedraw, model: d.nlModel ?? "" } : undefined;
  return { src, alt: img.alt ?? "", legend: legendOf(img), ...(redraw ? { redraw } : {}) };
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

/** A displayed equation a tap asks to have explained (M41 R4b): its LaTeX (kept in `alttext` at import) and its paragraph. */
export type TappedEquation = { latex: string; number: string | null; paragraph: unknown };

/** The displayed equation under a tap, if it carries its LaTeX; null for anything else (an inline formula too). */
export function equationAt(target: unknown): TappedEquation | null {
  const el = target as Partial<El> | null;
  if (!el || typeof el.closest !== "function") return null;
  const math = el.closest('math[display="block"]') as (El & { getAttribute(n: string): string | null }) | null;
  const latex = math?.getAttribute("alttext")?.trim();
  if (!math || !latex || math.closest("a")) return null;
  return { latex, number: /\\tag\*?\{([^}]{1,12})\}/.exec(latex)?.[1] ?? null, paragraph: math.closest("p, div") ?? math };
}

/**
 * A table wider than its column (M41): the book's style clips it there (settings.ts), so the reader marks it to say so
 * and to show it whole on a tap. Measured again whenever the page is laid out anew (a new size, a new type size).
 * An attribute only: no element is added to the book's page, so no note's anchor moves.
 */
export function markWideTables(doc: { querySelectorAll(sel: string): ArrayLike<unknown> }): number {
  let wide = 0;
  for (const t of Array.from(doc.querySelectorAll("table")) as { scrollWidth: number; clientWidth: number; toggleAttribute(n: string, on: boolean): void }[]) {
    const over = t.scrollWidth > t.clientWidth + 1;
    t.toggleAttribute("data-nl-wide", over);
    if (over) wide++;
  }
  return wide;
}

/** A table's content, copied out of the book's page as plain data (rendered by TableView.tsx): only the elements and
 * attributes a table and its formulas need. Never markup: a book's page may hold anything, and the copy is shown in the
 * reader's own page, where an `onerror` or a script would run. */
export type TableNode = { tag: string; attrs: Record<string, string>; kids: (TableNode | string)[] };
export type TappedTable = { caption: string; table: TableNode; cells: number };

const MATHML = "http://www.w3.org/1998/Math/MathML";
const HTML_TAGS = new Set(["table", "thead", "tbody", "tfoot", "tr", "th", "td", "p", "br", "span", "b", "strong", "i", "em", "sub", "sup", "small", "code", "abbr", "cite", "var", "s", "u", "mark"]);
const MATH_TAGS = new Set([
  "math", "semantics", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msub", "msup", "msubsup", "mfrac", "msqrt", "mroot", "mstyle",
  "mpadded", "mphantom", "menclose", "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mlabeledtr", "mmultiscripts", "mprescripts", "none", "merror",
]);
/** Dropped with all they hold (a caption is shown above the table on its own). */
const DROP = new Set(["caption", "script", "style", "annotation", "annotation-xml", "img", "svg", "iframe", "object", "embed", "template", "noscript"]);
const CELL_ATTRS = new Set(["colspan", "rowspan"]);
const MATH_ATTRS = new Set([
  "display", "mathvariant", "stretchy", "fence", "separator", "lspace", "rspace", "accent", "accentunder", "linethickness", "scriptlevel",
  "displaystyle", "columnalign", "rowalign", "columnspacing", "rowspacing", "columnlines", "rowlines", "frame", "width", "height", "depth",
  "voffset", "minsize", "maxsize", "movablelimits", "symmetric", "largeop", "form", "notation", "alttext", "mathsize", "columnspan",
]);
const ALIGN = /^(left|right|center)$/;

type DomNode = {
  nodeType: number;
  nodeValue: string | null;
  childNodes: ArrayLike<DomNode>;
  localName?: string;
  namespaceURI?: string | null;
  attributes?: ArrayLike<{ name: string; value: string }>;
  getAttribute?(n: string): string | null;
};

/** The table's content as plain data; elements outside the list keep their text, scripts and pictures go. */
export function cleanTable(table: unknown): TableNode {
  const kids = (n: DomNode, inMath: boolean): (TableNode | string)[] => Array.from(n.childNodes).flatMap((c) => walk(c, inMath));
  // Inside a formula, MathML's names hold (an XHTML page puts them in MathML's namespace; an HTML parser may not).
  const walk = (n: DomNode, inMath = false): (TableNode | string)[] => {
    if (n.nodeType === 3) return n.nodeValue ? [n.nodeValue] : [];
    if (n.nodeType !== 1) return [];
    const tag = (n.localName ?? "").toLowerCase();
    if (DROP.has(tag)) return [];
    const math = inMath || n.namespaceURI === MATHML || tag === "math";
    if (!(math ? MATH_TAGS : HTML_TAGS).has(tag)) return kids(n, math);
    const attrs: Record<string, string> = {};
    for (const a of Array.from(n.attributes ?? [])) {
      const name = a.name.toLowerCase();
      if (math ? MATH_ATTRS.has(name) : CELL_ATTRS.has(name) && /^\d{1,3}$/.test(a.value)) attrs[name] = a.value;
    }
    if (!math && (tag === "td" || tag === "th")) {
      // Column alignment: a Markdown table's class (markdown-epub.ts), or an older book's align attribute.
      const way = [n.getAttribute?.("align") ?? "", ...(n.getAttribute?.("class") ?? "").split(/\s+/)].find((w) => ALIGN.test(w));
      if (way) attrs["data-align"] = way;
    }
    return [{ tag, attrs, kids: kids(n, math) }];
  };
  const [root] = walk(table as DomNode);
  return root && typeof root !== "string" && root.tag === "table" ? root : { tag: "table", attrs: {}, kids: [] };
}

/** The clipped table under a tap, with its caption (a `<caption>`, or the paragraph before it that begins "Table 2");
 * null for anything else, a table that fits its column too (its cells are text to select like any other). */
export function tableAt(target: unknown): TappedTable | null {
  const el = target as Partial<El> | null;
  if (!el || typeof el.closest !== "function") return null;
  const table = el.closest("table[data-nl-wide]") as (El & { previousElementSibling: El | null; querySelectorAll(s: string): ArrayLike<unknown> }) | null;
  if (!table || table.closest("a")) return null;
  const own = table.querySelector("caption")?.textContent;
  const before = table.previousElementSibling?.textContent ?? "";
  const caption = own?.trim() ? tidy(own) : LEGEND.test(before) ? tidy(before) : "";
  return { caption, table: cleanTable(table), cells: table.querySelectorAll("td, th").length };
}
