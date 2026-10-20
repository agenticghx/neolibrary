/**
 * A Markdown book (M29): a `.md` file uploaded like an EPUB or a PDF is turned into an EPUB 3 here, at import, so
 * from then on it is an ordinary EPUB in the library: chapters, Contents, Listen, Study, rewrites, notes.
 *
 * Rules:
 * - Every level-1 or level-2 heading starts a new chapter (one XHTML file each). A part heading with nothing under it
 *   before the next heading is a part's title page, as in print. Text before the first heading is "Opening pages".
 * - Contents: level-1 headings at the top, each level-2 heading under the level-1 heading before it (or at the top
 *   when there is none).
 * - Headings of level 3 to 6 stay inside their chapter. Paragraphs (lines joined with spaces), block quotes (`> `),
 *   lists (`- `, `* `, `1. `) and rules (`---`) are understood; **bold**, __bold__, *italics*, _italics_ and
 *   `code`; a link keeps its text; a picture its description. Everything is escaped: no HTML from the file is
 *   passed through.
 * - Title and author: from front matter (`---` / `title: …` / `author: …` / `language: …` / `---`) when the file
 *   starts with it, else the title from the file name ("chip_war.md" is "Chip War") and no author.
 */
import { strToU8, zipSync } from "fflate";

export type MarkdownBook = { bytes: Uint8Array; title: string; author: string; chapters: number };

/** A file name that says Markdown. */
export const isMarkdownName = (name: string) => /\.(md|markdown)$/i.test(name.trim());

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline Markdown to XHTML. Escaped first, so only the marks below become tags. */
export function inline(text: string) {
  return (
    esc(text)
      // A picture keeps its description; a link keeps its text (no addresses from the file in the book).
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => (alt ? `<em>${alt}</em>` : ""))
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(?=\S)([^*]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w])__(?=\S)(.+?)__(?=[^\w]|$)/g, "$1<strong>$2</strong>")
      .replace(/\*(?=\S)([^*]+?)\*/g, "<em>$1</em>")
      // _italics_ only at word edges, so snake_case words stay as they are.
      .replace(/(^|[^\w])_(?=\S)(.+?)_(?=[^\w]|$)/g, "$1<em>$2</em>")
  );
}

/** "chip_war.md" → "Chip War": the file name's words, each with a capital first letter. */
export function titleFromName(name: string) {
  const words = name
    .replace(/^.*[\\/]/, "")
    .replace(/\.(md|markdown)$/i, "")
    .replace(/[_+\-.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || "Untitled";
}

type FrontMatter = { title?: string; author?: string; language?: string };

/** Front matter at the very start, if any, and the text after it. */
function frontMatter(md: string): { meta: FrontMatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta: FrontMatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(title|author|language|lang)\s*:\s*(.*)$/i.exec(line.trim());
    if (!kv) continue;
    const value = kv[2].trim().replace(/^["']|["']$/g, "");
    const key = kv[1].toLowerCase();
    if (key === "title") meta.title = value;
    else if (key === "author") meta.author = value;
    else meta.language = value;
  }
  return { meta, body: md.slice(m[0].length) };
}

type Chapter = { level: 1 | 2 | 0; title: string; html: string[] };

/** The chapters of a Markdown text (exported for tests). */
export function chaptersOf(body: string): Chapter[] {
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  const here = () => (current ??= (chapters.push({ level: 0, title: "Opening pages", html: [] }), chapters[chapters.length - 1]));
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) here().html.push(`<p>${inline(para.join(" ").trim())}</p>`);
    if (quote.length) here().html.push(`<blockquote><p>${inline(quote.join(" ").trim())}</p></blockquote>`);
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      here().html.push(`<${tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${tag}>`);
    }
    para = [];
    quote = [];
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level <= 2) {
        current = { level: level as 1 | 2, title: text.replace(/[*_`]/g, ""), html: [] };
        chapters.push(current);
      }
      here().html.push(`<h${level}>${inline(text)}</h${level}>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      here().html.push("<hr/>");
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      if (para.length || list) flush();
      quote.push(q[1]);
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item && !para.length) {
      const ordered = Boolean(item[2]);
      if (quote.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[3]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (quote.length || list) flush();
    para.push(line.trim());
  }
  flush();
  return chapters.filter((c) => c.html.length);
}

const CSS = `body { font-family: serif; line-height: 1.5; }
p { margin: 0 0 0.8em; }
h1, h2 { margin: 1.5em 0 1em; }
blockquote { margin: 1em 1.5em; }
code { font-family: monospace; font-size: 0.9em; }
`;

const xhtml = (title: string, body: string, lang: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}"><head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;

/** Short, stable id for a text: the same file gives the same book id inside the EPUB. */
function digest(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The Markdown file as an EPUB 3. `now` is the modified date written into the EPUB. */
export function markdownToEpub(md: string, fileName: string, now = new Date()): MarkdownBook {
  const { meta, body } = frontMatter(md.replace(/^﻿/, ""));
  const title = meta.title?.trim() || titleFromName(fileName);
  const author = meta.author?.trim() ?? "";
  const lang = meta.language?.trim() || "en";
  const chapters = chaptersOf(body);
  if (!chapters.length) throw new Error("empty");
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    // The mimetype comes first and uncompressed (the EPUB rule).
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/style.css": strToU8(CSS),
  };
  chapters.forEach((c, i) => {
    files[`OEBPS/c${i + 1}.xhtml`] = strToU8(xhtml(c.title, c.html.join("\n"), lang));
  });
  // Contents: level-2 chapters under the level-1 heading before them.
  type Entry = { label: string; href: string; children: Entry[] };
  const toc: Entry[] = [];
  let parent: Entry | null = null;
  chapters.forEach((c, i) => {
    const entry: Entry = { label: c.title, href: `c${i + 1}.xhtml`, children: [] };
    if (c.level === 2 && parent) parent.children.push(entry);
    else {
      toc.push(entry);
      parent = c.level === 1 ? entry : null;
    }
  });
  const ol = (entries: Entry[]): string =>
    `<ol>${entries.map((e) => `<li><a href="${e.href}">${esc(e.label)}</a>${e.children.length ? ol(e.children) : ""}</li>`).join("")}</ol>`;
  files["OEBPS/nav.xhtml"] = strToU8(xhtml("Contents", `<nav epub:type="toc" id="toc"><h1>Contents</h1>${ol(toc)}</nav>`, lang));
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...chapters.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`),
  ].join("");
  const spine = chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("");
  const modified = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const creator = author ? `<dc:creator>${esc(author)}</dc:creator>` : "";
  files["OEBPS/content.opf"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${esc(lang)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:neolibrary:markdown:${digest(md)}</dc:identifier><dc:title>${esc(title)}</dc:title>${creator}<dc:language>${esc(lang)}</dc:language><dc:source>A Markdown file, ${esc(fileName)}</dc:source><meta property="dcterms:modified">${modified}</meta></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
  );
  return { bytes: zipSync(files as Parameters<typeof zipSync>[0]), title, author, chapters: chapters.length };
}
