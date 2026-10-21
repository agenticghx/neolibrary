import type { EditionPage } from "./text-epub";

/**
 * A text edition from a PDF's own text (M31): for a PDF that already has text in it (not a scan), each page's text,
 * with its positions, sizes and fonts, is turned into the same Markdown a page read by Claude gives
 * (lib/library/text-epub.ts joins the pages into chapters). No model reads or copies anything: this is the reader's
 * own file, laid out again so it flows.
 *
 * What it reads from the page:
 * - Running heads and feet: a line in the top or bottom band of the page whose words (numbers aside) come back on
 *   three pages or more, and a line there that is only a page number. They are left out.
 * - The body's text height: the most common one. Smaller lines at the foot of the page are footnotes; a tiny number at
 *   the start of one starts a note (`[^n]: …`); a small raised number in the text is the reference to it (`[^n]`).
 * - Headings: a whole line in a heavier font (Medium, Semibold, Bold…) or larger than the body. The first such line
 *   in the top part of a page opens a chapter (`# `); others are sections (`## `). A short whole line in italics
 *   that starts with a number ("1. Paradigms and Community Structure") is a section too.
 * - Paragraphs: a line set in from the left margin starts one, as does a gap clearly larger than the usual line
 *   step. Lines are joined with spaces; a word broken at a line end ("conven-" "tional") is joined.
 * - Italics: words in an italic font are marked `*…*`.
 */

type Item = { str: string; x: number; y: number; w: number; h: number; font: string };
type Line = { y: number; x: number; h: number; items: Item[] };

export type PdfFonts = (fontId: string) => string;

/** A page's text as pdf.js gives it (exported for tests): items with their transform, size and font name. */
export type RawPage = { width: number; height: number; items: Item[] };

const isItalic = (font: string) => /italic|oblique/i.test(font);
const isHeavy = (font: string) => /medium|semibold|demi|bold|heavy|black/i.test(font);
const numberOnly = /^(\d{1,4}|[ivxlcdm]{1,8})$/i;
const norm = (s: string) => s.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

const mode = (xs: number[]) => {
  const count = new Map<number, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
};

/** Items into lines by baseline; a small raised number joins the line it sits on. */
function linesOf(items: Item[], body: number): Line[] {
  // Small raised text sits a little above the baseline of its line: a note number or reference (digits), or a
  // superscript letter (the "e" of "XVIIIe siècle"), which stays part of the text.
  const raised = (it: Item) => it.h > 0 && it.h < body * 0.75 && it.str.trim().length > 0 && it.str.trim().length <= 3;
  const rows: Line[] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of sorted.filter((i) => !raised(i))) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, x: it.x, h: it.h, items: [it] });
  }
  for (const it of sorted.filter(raised)) {
    // A note reference sits a little above the baseline of its line; a note's own number at a footnote's start
    // sits on (or just above) the footnote's line.
    const row = rows.filter((r) => it.y >= r.y - 1 && it.y - r.y <= body * 0.75).sort((a, b) => a.y - b.y)[0];
    if (row) row.items.push(/^\d{1,3}$/.test(it.str.trim()) ? { ...it, str: `\u0000${it.str.trim()}` } : { ...it, raisedText: true } as Item);
    else rows.push({ y: it.y, x: it.x, h: it.h, items: [it] });
  }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    r.x = r.items[0].x;
    r.h = mode(r.items.filter((i) => !i.str.startsWith("\u0000")).map((i) => Math.round(i.h))) || r.h;
  }
  return rows.sort((a, b) => b.y - a.y);
}

/** A line's text in Markdown: italics marked, note references as [^n]. */
function lineText(line: Line, asFootnote: boolean) {
  let out = "";
  let italicOpen = false;
  let first = true;
  for (const it of line.items) {
    if (it.str.startsWith("\u0000")) {
      const n = it.str.slice(1);
      if (asFootnote && first) out += `\u0001${n}\u0001`; // a note's own number, at its start
      else out = out.replace(/\s+$/, "") + `[^${n}]`;
      first = false;
      continue;
    }
    const text = it.str.replace(/\s+/g, " ");
    // A superscript letter belongs to the word before it: "XVIII" + "e".
    if ((it as Item & { raisedText?: boolean }).raisedText) {
      out = out.replace(/\*?\s*$/, (m) => (m.includes("*") ? "" : "")) + text.trim() + (italicOpen ? "" : "");
      first = false;
      continue;
    }
    if (!text.trim()) {
      if (!out.endsWith(" ")) out += " ";
      continue;
    }
    const italic = isItalic(it.font) && !isHeavy(it.font);
    if (italic !== italicOpen) {
      if (italic) out += (out && !out.endsWith(" ") ? " " : "") + "*";
      else out = out.replace(/\s+$/, "") + "* ";
      italicOpen = italic;
    } else if (out && !out.endsWith(" ") && !text.startsWith(" ")) out += " ";
    out += italic ? text.trim() : text;
    first = false;
  }
  if (italicOpen) out = out.replace(/\s+$/, "") + "*";
  // Tidy: no space inside the marks, none before punctuation, one space between words.
  return out
    .replace(/\*\s+/g, (m, i, s) => (s[i - 1] === undefined || s[i - 1] === " " ? "*" : m))
    .replace(/\s+\*(?=[\s.,;:!?)]|$)/g, "*")
    .replace(/\*\*/g, "")
    .replace(/\s+([.,;:!?)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Two lines of one paragraph joined. A word broken at the line end is mended: "phenom-" "enological" is one word;
 * but a word the book itself writes with a hyphen elsewhere ("mid-century") keeps it, and so does "pre- and post-".
 */
function joinLines(a: string, b: string, hyphenated: Set<string> = new Set()) {
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b) && !/^(and|or|to|nor)\b/.test(b)) {
    const left = /([A-Za-z]+)-$/.exec(a)![1].toLowerCase();
    const right = /^([a-z]+)/.exec(b)![1];
    return hyphenated.has(`${left}-${right}`) ? a + b : a.slice(0, -1) + b;
  }
  return `${a} ${b}`;
}

/** Every page of a text PDF as Markdown, in reading order. `pages` is what pdf.js gave for each. */
export function pagesFromPdfText(pages: RawPage[]): EditionPage[] {
  const all = pages.flatMap((p) => p.items.filter((i) => i.str.trim()));
  // The body's text height, to the half point (rounded to whole points, 13.5 became 14 and an 11-point footnote's
  // short words passed for raised marks).
  const body = mode(all.map((i) => Math.round(i.h * 2) / 2)) || 12;
  // Words the book writes with a hyphen inside a line: a line-end break of one of them keeps its hyphen.
  const hyphenated = new Set(all.flatMap((i) => i.str.toLowerCase().match(/[a-z]+-[a-z]+/g) ?? []));
  // Running heads and feet: words that come back in the top or bottom band of three pages or more.
  const bandLines = pages.map((p) => {
    const lines = linesOf(p.items.filter((i) => i.str.trim()), body);
    const inBand = (l: Line) => l.y > p.height * 0.86 || l.y < p.height * 0.2;
    return { lines, inBand };
  });
  const seen = new Map<string, Set<number>>();
  bandLines.forEach(({ lines, inBand }, i) => {
    for (const l of lines.filter(inBand)) {
      const key = norm(l.items.map((it) => it.str).join(" "));
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(i);
    }
  });
  const running = new Set([...seen].filter(([, ps]) => ps.size >= 3).map(([k]) => k));
  const leftOf = (lines: Line[]) => mode(lines.filter((l) => Math.abs(l.h - body) <= 1).map((l) => Math.round(l.x)));
  const left = mode(bandLines.map(({ lines }) => leftOf(lines)).filter(Boolean));

  return pages.map((p, i): EditionPage => {
    const page = i + 1;
    const { lines, inBand } = bandLines[i];
    const kept = lines.filter((l) => {
      const text = l.items.map((it) => it.str).join(" ").trim();
      if (!text) return false;
      if (inBand(l) && (running.has(norm(text)) || numberOnly.test(text.replace(/\u0000/g, "")))) return false;
      return true;
    });
    if (!kept.length) return { page, kind: "blank" };
    const blocks: string[] = [];
    const notes: string[] = [];
    let para: string | null = null;
    let lastY: number | null = null;
    const steps = kept.slice(1).map((l, k) => kept[k].y - l.y).filter((s) => s > 0);
    const step = mode(steps.map((s) => Math.round(s))) || body * 1.25;
    let firstHeadingSeen = false;
    const flush = () => {
      if (para !== null) blocks.push(para);
      para = null;
    };
    // Footnotes: the run of lines in smaller type at the foot of the page, wherever it starts.
    let noteFrom = kept.length;
    while (noteFrom > 0 && kept[noteFrom - 1].h < body * 0.9) noteFrom--;
    if (noteFrom === 0) noteFrom = kept.length; // a whole page in small type is text, not notes
    // Or a line that begins with a raised note number at the left margin: notes start there even when the book sets
    // them at the body's size (Kuhn p. 89). A reference in running text always follows a word, never starts a line.
    const opensNote = (l: Line) => l.items[0]?.str.startsWith("\u0000") && Math.abs(l.items[0].x - left) <= 4;
    const firstNote = kept.findIndex((l, k) => k > 0 && opensNote(l));
    if (firstNote > 0 && firstNote < noteFrom) noteFrom = firstNote;
    for (const [k, l] of kept.entries()) {
      const isNote = k >= noteFrom;
      const fonts = l.items.filter((it) => !it.str.startsWith("\u0000") && it.str.trim()).map((it) => it.font);
      const text = lineText(l, isNote);
      if (isNote) {
        const start = /^\u0001(\d+)\u0001\s*/.exec(text);
        if (start) notes.push(`[^${start[1]}]: ${text.slice(start[0].length)}`);
        else if (notes.length) notes[notes.length - 1] = joinLines(notes[notes.length - 1], text, hyphenated);
        // A note carried over from the page before: it ends that note ([^0], lib/library/text-epub.ts).
        else notes.push(`[^0]: ${text}`);
        continue;
      }
      const heavy = fonts.length > 0 && fonts.every(isHeavy) && !fonts.every(isItalic);
      const larger = l.h > body * 1.15;
      const words = text.replace(/\*/g, "").split(/\s+/).length;
      // "3. Paradigms as Shared Examples": a number, then words all in italics (the number itself may be upright).
      const wordFonts = l.items.filter((it) => !it.str.startsWith("\u0000") && it.str.trim() && !/^\d+\.?$/.test(it.str.trim())).map((it) => it.font);
      const italicSection = wordFonts.length > 0 && wordFonts.every(isItalic) && words <= 12 && /^\d+\.\s/.test(text.replace(/\*/g, ""));
      const headingFont = fonts.length > 0 && fonts.every(isHeavy);
      if ((heavy || larger || headingFont || italicSection) && words <= 16 && !/[,;]$/.test(text)) {
        flush();
        const clean = text.replace(/\*/g, "").replace(/\[\^\d+\]/g, "").trim();
        const top = l.y > p.height * 0.7;
        const level = !italicSection && !firstHeadingSeen && top && blocks.length === 0 ? 1 : 2;
        firstHeadingSeen = true;
        blocks.push(`${"#".repeat(level)} ${clean}`);
        lastY = l.y;
        continue;
      }
      // Set in from the margin starts a paragraph, but only after a line that ends a sentence: some PDFs indent a line
      // in mid-sentence (Kuhn p. 157), and a displayed formula is set in too.
      const indented = left && l.x > left + 6 && (para === null || /[.!?:”"’)\]]$|\*$/.test(para));
      const gap = lastY !== null && lastY - l.y > step * 1.6;
      if (para === null || indented || gap) {
        flush();
        para = text;
      } else para = joinLines(para, text, hyphenated);
      lastY = l.y;
    }
    flush();
    // A chapter opens with its text: a top heading followed by fewer than 20 words of prose on its page (a title page,
    // a series' board of editors in capitals) is not a chapter, only a heading in the pages around it.
    const firstOne = blocks.findIndex((b) => b.startsWith("# "));
    if (firstOne >= 0) {
      const text = blocks.slice(firstOne + 1).filter((b) => !b.startsWith("#")).join(" ");
      const letters = text.replace(/[^A-Za-z]/g, "");
      const prose = letters.length > 0 && letters.replace(/[^a-z]/g, "").length / letters.length >= 0.5;
      if (text.split(/\s+/).filter(Boolean).length < 20 || !prose) blocks[firstOne] = `#${blocks[firstOne]}`;
    }
    const markdown = [...blocks, ...notes].join("\n\n").replace(/\u0001/g, "");
    return markdown.trim() ? { page, kind: "read", markdown } : { page, kind: "blank" };
  });
}

/** A PDF's pages as pdf.js gives them, with each item's font's real name (it tells Book from Medium and Italic). */
export async function rawPdfPages(bytes: Uint8Array): Promise<RawPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    fontExtraProperties: true,
    disableFontFace: true,
    standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`,
    cMapUrl: `${process.cwd()}/node_modules/pdfjs-dist/cmaps/`,
    cMapPacked: true,
  });
  const pdf = await task.promise;
  const out: RawPage[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      await page.getOperatorList(); // loads the fonts, so their names can be read
      const content = await page.getTextContent();
      const fontName = (id: string) => {
        try {
          return String((page.commonObjs.get(id) as { name?: string } | undefined)?.name ?? id);
        } catch {
          return id;
        }
      };
      const items = (content.items as { str?: string; transform?: number[]; width?: number; height?: number; fontName?: string }[])
        .filter((it) => typeof it.str === "string" && it.transform)
        .map((it) => ({ str: it.str!, x: it.transform![4], y: it.transform![5], w: it.width ?? 0, h: Math.round((it.height ?? 0) * 10) / 10, font: fontName(it.fontName ?? "") }));
      out.push({ width, height, items });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}

/** True when a PDF has text of its own on most of its pages (not a scan): an edition can be made from it. */
export function hasOwnText(pages: RawPage[]) {
  const withText = pages.filter((p) => p.items.reduce((n, it) => n + it.str.trim().length, 0) > 200).length;
  return pages.length > 0 && withText / pages.length >= 0.5;
}
