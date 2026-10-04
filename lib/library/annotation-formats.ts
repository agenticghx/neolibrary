import type { Annotation, Color, Kind } from "./annotations";
import { isSticker, STICKERS, type Sticker } from "./stickers";
import { cleanDrawing, type Drawing } from "./drawings";

/**
 * Annotation exports (M5, ground rule 7):
 * - Markdown, for people and note apps (Apple Notes, Obsidian, email);
 * - W3C Web Annotation JSON (https://www.w3.org/TR/annotation-model/), the
 *   standard format other tools read. Each passage target carries a
 *   TextQuoteSelector (the quote) and a FragmentSelector holding the EPUB CFI.
 */
export type BookInfo = { id: string; title: string; author: string };

const CFI_SPEC = "http://www.idpf.org/epub/linking/cfi/epub-cfi.html";
const MOTIVATION: Record<Kind, string> = {
  highlight: "highlighting",
  bookmark: "bookmarking",
  note: "commenting",
  voice: "commenting",
  sticker: "tagging",
  drawing: "commenting",
};

/** What a note says in text: the sticker's name, its body, and for a voice note the transcript. */
const noteText = (a: Annotation) =>
  [
    a.sticker ? `Sticker: ${STICKERS[a.sticker].label}` : "",
    a.drawing ? `Handwritten note (${a.drawing.strokes.length} ${a.drawing.strokes.length === 1 ? "stroke" : "strokes"})` : "",
    a.body.trim(),
    a.voice?.transcript.trim() ? `Voice note: ${a.voice.transcript.trim()}` : a.voice ? "Voice note (no transcript)" : "",
  ]
    .filter(Boolean)
    .join("\n\n");
const KIND_OF: Record<string, Kind> = { highlighting: "highlight", bookmarking: "bookmark", commenting: "note", tagging: "sticker" };

/** Markdown: the book's notes, then passages under their chapter headings. */
export function toMarkdown(book: BookInfo, items: Annotation[], chapterOf: (a: Annotation) => string, exportedAt = new Date()) {
  const lines: string[] = [`# ${book.title}`];
  if (book.author) lines.push("", `*${book.author}*`);
  lines.push("", `Exported from Neolibrary on ${exportedAt.toISOString().slice(0, 10)}.`);
  const bookNotes = items.filter((a) => a.targetType === "book" && a.kind === "note");
  if (bookNotes.length) {
    lines.push("", "## Notes on the book");
    for (const n of bookNotes) lines.push("", n.body.trim());
  }
  let chapter: string | null = null;
  for (const a of items.filter((x) => x.cfi)) {
    const c = chapterOf(a) || "Passages";
    if (c !== chapter) {
      lines.push("", `## ${c}`);
      chapter = c;
    }
    if (a.kind === "bookmark") {
      lines.push("", `- Bookmark: ${a.quote.exact.slice(0, 120)}${a.quote.exact.length > 120 ? "…" : ""}`);
      continue;
    }
    lines.push("", ...a.quote.exact.split("\n").map((l) => `> ${l}`));
    if (noteText(a)) lines.push("", noteText(a));
  }
  return lines.join("\n") + "\n";
}

export type W3CAnnotation = {
  id: string;
  type: "Annotation";
  motivation: string;
  created: string;
  modified: string;
  body?: { type: "TextualBody"; value: string; format: "text/plain"; purpose: "commenting" | "tagging" }[];
  target: {
    source: string;
    selector?: (
      | { type: "TextQuoteSelector"; exact: string; prefix: string; suffix: string }
      | { type: "FragmentSelector"; conformsTo: string; value: string }
    )[];
  };
  /** Neolibrary extras that the standard has no slot for. */
  "neolibrary:color"?: Color | null;
  "neolibrary:sectionId"?: string | null;
  "neolibrary:sticker"?: Sticker;
  "neolibrary:drawing"?: Drawing;
};

export type W3CCollection = {
  "@context": "http://www.w3.org/ns/anno.jsonld";
  type: "AnnotationCollection";
  label: string;
  total: number;
  first: { type: "AnnotationPage"; items: W3CAnnotation[] };
};

export const bookUrn = (id: string) => `urn:neolibrary:book:${id}`;

export function toW3C(book: BookInfo, items: Annotation[]): W3CCollection {
  const out = items.map<W3CAnnotation>((a) => ({
    id: `urn:uuid:${a.id}`,
    type: "Annotation",
    motivation: MOTIVATION[a.kind],
    created: a.createdAt,
    modified: a.updatedAt,
    ...(noteText(a)
      ? {
          body: [
            {
              type: "TextualBody",
              value: a.voice || a.sticker || a.drawing ? noteText(a) : a.body,
              format: "text/plain",
              purpose: a.sticker ? "tagging" : "commenting",
            },
          ],
        }
      : {}),
    target: {
      source: bookUrn(book.id),
      ...(a.cfi
        ? {
            selector: [
              { type: "TextQuoteSelector", exact: a.quote.exact, prefix: a.quote.prefix, suffix: a.quote.suffix },
              { type: "FragmentSelector", conformsTo: CFI_SPEC, value: a.cfi },
            ],
          }
        : {}),
    },
    "neolibrary:color": a.color,
    "neolibrary:sectionId": a.sectionId,
    ...(a.sticker ? { "neolibrary:sticker": a.sticker } : {}),
    ...(a.drawing ? { "neolibrary:drawing": a.drawing } : {}),
  }));
  return {
    "@context": "http://www.w3.org/ns/anno.jsonld",
    type: "AnnotationCollection",
    label: `Annotations on ${book.title}${book.author ? ` by ${book.author}` : ""}`,
    total: out.length,
    first: { type: "AnnotationPage", items: out },
  };
}

export class FormatError extends Error {}

export type ImportedAnnotation = {
  id: string | null;
  kind: Kind;
  cfi: string | null;
  quote: { exact: string; prefix: string; suffix: string };
  body: string;
  color: Color | null;
  sticker: Sticker | null;
  drawing: Drawing | null;
  created: string | null;
  modified: string | null;
};

/** Reads a W3C AnnotationCollection (or a bare list of annotations). */
export function fromW3C(data: unknown): ImportedAnnotation[] {
  const d = data as Partial<W3CCollection> & { items?: W3CAnnotation[] };
  const items: unknown = Array.isArray(data) ? data : d?.first?.items ?? d?.items;
  if (!Array.isArray(items)) throw new FormatError("This is not a W3C Web Annotation file.");
  return items.map((raw) => {
    const a = raw as W3CAnnotation;
    if (a?.type !== "Annotation") throw new FormatError("This is not a W3C Web Annotation file.");
    const sticker = isSticker(a["neolibrary:sticker"]) ? a["neolibrary:sticker"] : null;
    const drawing = cleanDrawing(a["neolibrary:drawing"]);
    // A "tagging" annotation from another tool (no Neolibrary sticker) comes in as a note.
    const kind = sticker
      ? "sticker"
      : drawing
        ? "drawing"
        : KIND_OF[a.motivation] === "sticker"
          ? "note"
          : (KIND_OF[a.motivation] ?? (a.body?.length ? "note" : "highlight"));
    const selectors = a.target?.selector ?? [];
    const quote = selectors.find((s) => s.type === "TextQuoteSelector") as
      | { exact: string; prefix?: string; suffix?: string }
      | undefined;
    const fragment = selectors.find((s) => s.type === "FragmentSelector") as { value: string } | undefined;
    const id = /^urn:uuid:([0-9a-f-]{36})$/i.exec(a.id ?? "")?.[1] ?? null;
    return {
      id,
      kind,
      cfi: fragment?.value ?? null,
      quote: { exact: quote?.exact ?? "", prefix: quote?.prefix ?? "", suffix: quote?.suffix ?? "" },
      body: sticker || drawing ? "" : (a.body?.map((b) => b.value).join("\n\n") ?? ""),
      color: a["neolibrary:color"] ?? null,
      sticker,
      drawing,
      created: a.created ?? null,
      modified: a.modified ?? null,
    };
  });
}
