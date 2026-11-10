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
import { inlineMathSpans, mathMl } from "./markdown-math";
import { Pictures } from "./markdown-pictures";

export type MarkdownBook = {
  bytes: Uint8Array;
  title: string;
  author: string;
  chapters: number;
  /** M41 R2: pictures put in the book, and the addresses of pictures the text names but the upload lacks. */
  pictures: { used: number; missing: string[] };
};

/** A file name that says Markdown. */
export const isMarkdownName = (name: string) => /\.(md|markdown)$/i.test(name.trim());

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Inline Markdown to XHTML. Escaped first, so only the marks below become tags. Inline equations (`$…$`, M41) are set
 * aside before the marks are read, so a star or an underscore inside one is LaTeX, not italics, and put back as
 * MathML at the end; so are backslash escapes.
 */
export function inline(raw: string, pictures?: Pictures) {
  const kept: string[] = [];
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;
  // A picture the upload holds becomes the picture (M41 R2); one it lacks keeps its description, below.
  const text = raw.replace(/\u0000/g, "").replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (all, alt: string, src: string) => {
    const pic = pictures?.resolve(src);
    return pic ? keep(`<img src="${esc(pic.href)}" alt="${esc(alt.replace(/[*_`]/g, ""))}"/>`) : all;
  });
  let rest = "";
  let at = 0;
  for (const span of inlineMathSpans(text)) {
    const math = mathMl(span.tex, false);
    rest += text.slice(at, span.start) + (math ? keep(math) : text.slice(span.start, span.end));
    at = span.end;
  }
  rest += text.slice(at);
  // A backslash escape outside code is the character itself.
  rest = rest.replace(/(`[^`]*`)|\\([!-/:-@[-`{-~])/g, (_, code: string | undefined, ch: string) => code ?? keep(esc(ch)));
  return marks(rest).replace(/\u0000(\d+)\u0000/g, (_, n: string) => kept[Number(n)]);
}

function marks(text: string) {
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

/** The cells of a table row: `| a | b |` is ["a", "b"]; a `|` inside an equation or after a backslash is not a border. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cell = "";
  let math = false;
  const line = row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && line[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (c === "\\") {
      cell += c + (line[i + 1] ?? "");
      i += 1;
    } else if (c === "$") {
      math = !math;
      cell += c;
    } else if (c === "|" && !math) {
      out.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

function tableHtml(rows: string[], align: string[], pictures?: Pictures) {
  const td = (tag: "th" | "td", text: string, i: number) => `<${tag}${align[i] ? ` class="${align[i]}"` : ""}>${inline(text, pictures)}</${tag}>`;
  const [head, ...body] = rows;
  const th = cells(head).map((c, i) => td("th", c, i)).join("");
  const trs = body.map((r) => `<tr>${cells(r).map((c, i) => td("td", c, i)).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

type Chapter = { level: 1 | 2 | 0; title: string; html: string[] };

/** The chapters of a Markdown text (exported for tests). */
export function chaptersOf(body: string, pictures?: Pictures): Chapter[] {
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  const here = () => (current ??= (chapters.push({ level: 0, title: "Opening pages", html: [] }), chapters[chapters.length - 1]));
  // HTML comments are notes for whoever edits the file (M41: a transcription's page markers); readers never see them.
  // One written inside backticks is shown, not hidden: Greco's note says its page markers look like `<!-- page 345 -->`.
  const lines = body
    .replace(/\r\n?/g, "\n")
    .replace(/(`+)[^`\n]*?\1|[ \t]*<!--[\s\S]*?-->/g, (m, ticks?: string) => (ticks ? m : ""))
    .split("\n");
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) {
      const html = inline(para.join(" ").trim(), pictures);
      // A paragraph that is one picture is a figure (M41 R2): centred, as wide as the column allows.
      here().html.push(/^<img [^>]*\/>$/.test(html) ? `<p class="figure">${html}</p>` : `<p>${html}</p>`);
    }
    if (quote.length) here().html.push(`<blockquote><p>${inline(quote.join(" ").trim(), pictures)}</p></blockquote>`);
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      here().html.push(`<${tag}>${list.items.map((i) => `<li>${inline(i, pictures)}</li>`).join("")}</${tag}>`);
    }
    para = [];
    quote = [];
    list = null;
  };
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const line = raw.trimEnd();
    // A display equation (M41): `$$` … `$$`, on one line or several.
    if (/^\s*\$\$/.test(line)) {
      flush();
      // It ends at the next `$$`, wherever on a line that is: "$$x = y$$." (a full stop after it) ends there too.
      const block = [line.trim().slice(2)];
      while (!block[block.length - 1].includes("$$") && n + 1 < lines.length) block.push(lines[++n].trimEnd());
      const all = block.join("\n");
      const close = all.indexOf("$$");
      const tex = close < 0 ? all : all.slice(0, close);
      const math = mathMl(tex, true);
      here().html.push(`<p class="equation">${math ?? `<code>${esc(`$$${tex}$$`)}</code>`}</p>`);
      // Words after the closing `$$` on its line start the next paragraph; punctuation alone is dropped.
      const after = close < 0 ? "" : all.slice(close + 2).trim();
      if (/[\p{L}\p{N}]/u.test(after)) para.push(after);
      continue;
    }
    // A table (M41): a row of cells, a line of dashes under it, then the rows.
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[n + 1] ?? "")) {
      flush();
      const rows = [line];
      n += 1;
      const align = cells(lines[n]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
      while (n + 1 < lines.length && /^\s*\|/.test(lines[n + 1])) rows.push(lines[++n].trimEnd());
      here().html.push(tableHtml(rows, align, pictures));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level <= 2) {
        current = { level: level as 1 | 2, title: text.replace(/[*_`]/g, ""), html: [] };
        chapters.push(current);
      }
      here().html.push(`<h${level}>${inline(text, pictures)}</h${level}>`);
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
p.equation { margin: 1em 0; overflow-x: auto; overflow-y: hidden; }
math[display="block"] mtd { math-style: normal; }
table { border-collapse: collapse; margin: 1em 0; font-size: 0.85em; display: block; width: max-content; max-width: 100%; overflow-x: auto; }
th, td { border-bottom: 1px solid rgba(128, 128, 128, 0.4); padding: 0.25em 0.5em; text-align: left; vertical-align: top; }
th.right, td.right { text-align: right; }
th.center, td.center { text-align: center; }
p.figure { margin: 1em 0; text-align: center; }
img { max-width: 100%; height: auto; }
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
export function markdownToEpub(md: string, fileName: string, now = new Date(), pictures = new Pictures()): MarkdownBook {
  const { meta, body } = frontMatter(md.replace(/^﻿/, ""));
  const title = meta.title?.trim() || titleFromName(fileName);
  const author = meta.author?.trim() ?? "";
  const lang = meta.language?.trim() || "en";
  const chapters = chaptersOf(body, pictures);
  if (!chapters.length) throw new Error("empty");
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    // The mimetype comes first and uncompressed (the EPUB rule).
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/style.css": strToU8(CSS),
  };
  // Pictures are already compressed: stored as they are.
  for (const p of pictures.used) files[`OEBPS/${p.href}`] = [p.bytes, { level: 0 }];
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
    // EPUB 3 asks a page holding MathML to say so (M41).
    ...pictures.used.map((p, i) => `<item id="img${i + 1}" href="${p.href}" media-type="${p.mediaType}"/>`),
    ...chapters.map((c, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"${c.html.some((h) => h.includes("<math")) ? ' properties="mathml"' : ""}/>`),
  ].join("");
  const spine = chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("");
  const modified = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const creator = author ? `<dc:creator>${esc(author)}</dc:creator>` : "";
  files["OEBPS/content.opf"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${esc(lang)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:neolibrary:markdown:${digest(md)}</dc:identifier><dc:title>${esc(title)}</dc:title>${creator}<dc:language>${esc(lang)}</dc:language><dc:source>A Markdown file, ${esc(fileName)}</dc:source><meta property="dcterms:modified">${modified}</meta></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
  );
  // Every entry in the zip is stamped with the EPUB's own modified date, not the clock: the same file makes the same bytes
  // (CI run 39907837623, 2026-10-23: two builds a second apart differed in the entries' times alone).
  return { bytes: zipSync(files as Parameters<typeof zipSync>[0], { mtime: now }), title, author, chapters: chapters.length, pictures: { used: pictures.used.length, missing: [...pictures.missing] } };
}
