/**
 * The text edition's EPUB (M25 S5, docs/scan-to-text-plan.md): the pages
 * Claude read from a scanned PDF, joined into one flowing book that the
 * reader opens like any EPUB (font size, Focus, Night, a phone).
 *
 * Joining rules:
 * - A paragraph that ends a page without closing punctuation goes on into
 *   the first paragraph of the next page; a word broken at the page end
 *   ("eco-" then "nomy") is joined.
 * - Every page keeps an invisible page marker (EPUB's `epub:type="pagebreak"`)
 *   numbered by its page in the scan, listed in the navigation's page list,
 *   so "Go to page" works and each page can lead back to its scan.
 * - A level-1 heading starts a chapter; what comes before the first one is
 *   the opening pages.
 * - Footnotes are gathered at the end of their chapter, linked both ways.
 * - A page not read says so; a blank page leaves only its marker.
 * - Machine-written text says so (ground rule 5): an "About this edition"
 *   page opens the book, naming the model, the date and the pages to check.
 *
 * Only the Markdown the instructions ask for is understood (headings,
 * paragraphs, emphasis, tables, footnotes, figures, simple lists); anything
 * else is kept as text. Nothing is passed through as HTML.
 */
import { strToU8, zipSync } from "fflate";

export type EditionPage =
  | { page: number; kind: "read"; markdown: string }
  | { page: number; kind: "blank" }
  | { page: number; kind: "unread" };

export type EditionMeta = {
  bookId: string;
  title: string;
  author: string;
  language: string | null;
  model: string;
  madeAt: Date;
  /** Pages whose reading disagreed with the scan's own text. */
  toCheck: number[];
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const noteId = (page: number, n: string) => `note-${page}-${n}`;
const refId = (page: number, n: string) => `ref-${page}-${n}`;

/** Inline Markdown to XHTML: escaped text, **bold**, *italics*, and footnote references. */
function inline(text: string, page: number) {
  return esc(text)
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(?=\S)([^*]+?)\*/g, "<em>$1</em>")
    .replace(/\[\^(\d+)\]/g, (_, n: string) => `<a epub:type="noteref" role="doc-noteref" id="${refId(page, n)}" href="#${noteId(page, n)}"><sup>${n}</sup></a>`);
}

const pageMark = (page: number) => `<span epub:type="pagebreak" role="doc-pagebreak" id="page-${page}" aria-label="${page}"></span>`;

type Item =
  | { type: "mark"; page: number }
  | { type: "heading"; level: number; text: string; page: number }
  /** A paragraph; a part after the first went on from an earlier page (`joined`: a word broken across the page break). */
  | { type: "p"; parts: { text: string; page: number; joined?: boolean }[] }
  | { type: "html"; html: string };

type Note = { page: number; n: string; text: string };

function tableHtml(lines: string[], page: number) {
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const [head, , ...body] = lines;
  const th = cells(head).map((c) => `<th>${inline(c, page)}</th>`).join("");
  const rows = body.map((l) => `<tr>${cells(l).map((c) => `<td>${inline(c, page)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Which page's reference a footnote belongs to: the reference with its number
 * on the same page, else the latest one before it still without its note
 * (a note can be printed on the page after its reference).
 */
function footnoteOwners(pages: { page: number; markdown: string }[]) {
  const refs: { page: number; n: string; taken: boolean }[] = [];
  for (const p of pages) for (const m of p.markdown.matchAll(/\[\^(\d+)\](?!:)/g)) refs.push({ page: p.page, n: m[1], taken: false });
  return (page: number, n: string) => {
    const same = refs.find((r) => r.page === page && r.n === n && !r.taken);
    const earlier = [...refs].reverse().find((r) => r.page < page && r.n === n && !r.taken);
    const ref = same ?? earlier;
    if (!ref) return page;
    ref.taken = true;
    return ref.page;
  };
}

/** One page's Markdown as items, its footnotes set aside under the page of their reference. */
function pageItems(page: number, markdown: string, notes: Note[], ownerOf: (page: number, n: string) => number): Item[] {
  const items: Item[] = [];
  for (const raw of markdown.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const block = raw.trim();
    if (!block) continue;
    const lines = block.split("\n").map((l) => l.trim());
    const note = /^\[\^(\d+)\]:\s*([\s\S]*)$/.exec(block);
    const heading = /^(#{1,6})\s+(.+)$/.exec(block);
    const figure = /^\[Figure:\s*([\s\S]*)\]$/.exec(block);
    if (note) notes.push({ page: ownerOf(page, note[1]), n: note[1], text: note[2].replace(/\s*\n\s*/g, " ") });
    else if (heading && lines.length === 1) items.push({ type: "heading", level: heading[1].length, text: heading[2].replace(/\s*#+$/, ""), page });
    else if (lines.length >= 2 && lines[0].startsWith("|") && /^\|?\s*:?-{2,}/.test(lines[1])) items.push({ type: "html", html: tableHtml(lines, page) });
    else if (figure) items.push({ type: "html", html: `<p class="figure">[Figure: ${inline(figure[1], page)}]</p>` });
    else if (lines.every((l) => /^(\d+\.|[-*])\s+/.test(l)) && (lines.length > 1 || /^[-*]\s/.test(lines[0]))) {
      const ordered = /^\d+\./.test(lines[0]);
      const li = lines.map((l) => `<li>${inline(l.replace(/^(\d+\.|[-*])\s+/, ""), page)}</li>`).join("");
      items.push({ type: "html", html: ordered ? `<ol>${li}</ol>` : `<ul>${li}</ul>` });
    } else items.push({ type: "p", parts: [{ text: lines.join(" "), page }] });
  }
  return items;
}

/** A paragraph that ends this way is finished; one that does not goes on into the next page. */
const FINISHED = /[.!?:;)\]"'’”…*]$/;

export type EditionChapter = { title: string; html: string; pages: number[] };

/** The pages joined into chapters, with their footnotes at the end of each. */
export function assembleEdition(pages: EditionPage[]): EditionChapter[] {
  const notes: Note[] = [];
  const items: Item[] = [];
  const lastParagraph = () => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === "mark") continue;
      return it.type === "p" ? it : null;
    }
    return null;
  };
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const ownerOf = footnoteOwners(sorted.flatMap((p) => (p.kind === "read" ? [p] : [])));
  for (const p of sorted) {
    if (p.kind !== "read") {
      items.push({ type: "mark", page: p.page });
      if (p.kind === "unread") items.push({ type: "html", html: `<p class="unread">Page ${p.page} was not read. See it in the scan.</p>` });
      continue;
    }
    const these = pageItems(p.page, p.markdown, notes, ownerOf);
    const prev = lastParagraph();
    const first = these[0];
    const prevText = prev?.parts[prev.parts.length - 1].text ?? "";
    if (prev && first?.type === "p" && !FINISHED.test(prevText)) {
      // The paragraph goes on across the page break: the marker sits inside it.
      const broken = /[A-Za-z]-$/.test(prevText) && /^[a-z]/.test(first.parts[0].text);
      if (broken) prev.parts[prev.parts.length - 1].text = prevText.slice(0, -1);
      prev.parts.push({ text: first.parts[0].text, page: p.page, joined: broken });
      items.push(...these.slice(1));
    } else {
      items.push({ type: "mark", page: p.page }, ...these);
    }
  }

  type Building = { title: string; parts: string[]; pages: Set<number> };
  const building: Building[] = [];
  const open = (title: string) => {
    const c: Building = { title, parts: [], pages: new Set() };
    building.push(c);
    return c;
  };
  const html = (it: Item, c: Building) => {
    if (it.type === "mark") {
      c.pages.add(it.page);
      return pageMark(it.page);
    }
    if (it.type === "heading") return `<h${it.level}>${inline(it.text, it.page)}</h${it.level}>`;
    if (it.type === "html") return it.html;
    const body = it.parts
      .map((part, i) => {
        if (i === 0) return inline(part.text, part.page);
        c.pages.add(part.page);
        return `${part.joined ? "" : " "}${pageMark(part.page)}${inline(part.text, part.page)}`;
      })
      .join("");
    return `<p>${body}</p>`;
  };
  let current: Building | null = null;
  for (const it of items) {
    if (it.type === "heading" && it.level === 1) current = open(it.text);
    current ??= open("Opening pages");
    current.parts.push(html(it, current));
  }
  // A page whose first item is a chapter heading: its marker belongs at the start of that chapter, not the end of the
  // last (only that one: a blank page before it stays where it was).
  for (let i = 0; i + 1 < building.length; i++) {
    const c = building[i];
    if (c.parts.length && c.parts[c.parts.length - 1].startsWith('<span epub:type="pagebreak"')) {
      const mark = c.parts.pop()!;
      const page = Number(/id="page-(\d+)"/.exec(mark)?.[1]);
      c.pages.delete(page);
      building[i + 1].parts.unshift(mark);
      building[i + 1].pages.add(page);
    }
  }
  // A chapter left with nothing once its markers moved on (the book's first page starts with a chapter heading).
  return building.filter((c) => c.parts.length).map((c) => {
    const here = notes.filter((n) => c.pages.has(n.page));
    const notesHtml = here.length
      ? `<section epub:type="footnotes" role="doc-endnotes" class="notes"><h2>Notes</h2>${here
          .map((n) => `<aside epub:type="footnote" role="doc-footnote" id="${noteId(n.page, n.n)}"><p><a href="#${refId(n.page, n.n)}" role="doc-backlink">${n.n}.</a> ${inline(n.text, n.page)}</p></aside>`)
          .join("")}</section>`
      : "";
    return { title: c.title, html: c.parts.join("\n") + notesHtml, pages: [...c.pages].sort((a, b) => a - b) };
  });
}

const CSS = `body { font-family: serif; line-height: 1.5; }
p { margin: 0 0 0.8em; }
table { border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid #999; padding: 0.2em 0.4em; vertical-align: top; text-align: left; }
.about { font-family: sans-serif; }
.about p.made { font-style: italic; }
.unread, .figure { font-family: sans-serif; font-style: italic; opacity: 0.8; }
.notes { margin-top: 2em; font-size: 0.9em; border-top: 1px solid #999; }
`;

const xhtml = (title: string, body: string, lang: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}"><head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;

/** The whole text edition as an EPUB 3 file. */
export function buildTextEdition(pages: EditionPage[], meta: EditionMeta): Uint8Array {
  const lang = meta.language || "en";
  const chapters = assembleEdition(pages);
  const day = meta.madeAt.toISOString().slice(0, 10);
  const read = pages.filter((p) => p.kind === "read").length;
  const check = meta.toCheck.length
    ? `<p>Pages to check against the scan (this reading and the scan's own text disagree there): ${meta.toCheck.map((n) => `<a href="${fileOfPage(chapters, n)}#page-${n}">${n}</a>`).join(", ")}.</p>`
    : "";
  const about = xhtml(
    "About this edition",
    `<section class="about"><h1>About this edition</h1><p class="made">This text was read from the scanned pages of the PDF by ${esc(meta.model)} on ${day}, page by page (${read} of ${pages.length} pages; blank pages left out). It is machine-written: the scan is the original, and each page here is marked with its page number in the scan.</p>${check}</section>`,
    lang,
  );
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    // The mimetype comes first and uncompressed (the EPUB rule), so a reader can tell what the file is.
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/style.css": strToU8(CSS),
    "OEBPS/about.xhtml": strToU8(about),
  };
  chapters.forEach((c, i) => {
    files[`OEBPS/c${i + 1}.xhtml`] = strToU8(xhtml(c.title, c.html, lang));
  });
  const toc = chapters.map((c, i) => `<li><a href="c${i + 1}.xhtml">${esc(c.title)}</a></li>`).join("");
  const pageList = chapters
    .flatMap((c, i) => c.pages.map((n) => `<li><a href="c${i + 1}.xhtml#page-${n}">${n}</a></li>`))
    .join("");
  files["OEBPS/nav.xhtml"] = strToU8(
    xhtml(
      "Contents",
      `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="about.xhtml">About this edition</a></li>${toc}</ol></nav><nav epub:type="page-list" id="page-list" hidden="hidden"><h1>Pages</h1><ol>${pageList}</ol></nav>`,
      lang,
    ),
  );
  const modified = meta.madeAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="about" href="about.xhtml" media-type="application/xhtml+xml"/>',
    ...chapters.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`),
  ].join("");
  const spine = ['<itemref idref="about"/>', ...chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`)].join("");
  files["OEBPS/content.opf"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${esc(lang)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:neolibrary:text-edition:${esc(meta.bookId)}</dc:identifier><dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.author)}</dc:creator><dc:language>${esc(lang)}</dc:language><dc:source>A scanned PDF, read page by page by ${esc(meta.model)}</dc:source><meta property="dcterms:modified">${modified}</meta></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
  );
  return zipSync(files as Parameters<typeof zipSync>[0]);
}

function fileOfPage(chapters: EditionChapter[], page: number) {
  const i = chapters.findIndex((c) => c.pages.includes(page));
  return i < 0 ? "about.xhtml" : `c${i + 1}.xhtml`;
}
