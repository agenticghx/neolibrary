import type { PaletteData } from "./data";
import { rank, scoreFields } from "./score";

/**
 * The command palette's rows (M21): what each one says, where it goes, and what a query is matched against.
 * Pure functions, so the order of results is unit-tested (items.test.ts) and the component only draws them.
 */
export type PaletteKind = "page" | "book" | "read" | "path" | "pillar" | "note" | "search";

export type PaletteItem = {
  key: string;
  kind: PaletteKind;
  label: string;
  /** A second, quieter line: the author, the Path, the book a note is in. */
  detail?: string;
  /** The small word on the right: Page, Book, Reader, Path, Section, Note, Highlight, Voice note, Search. */
  tag: string;
  href: string;
  /** Text to match, each with its weight (1: the title itself). */
  fields: [string, number][];
};

/** The app's pages. `words`: other words a reader might type for them. Admin pages only for an admin. */
export const PAGES: { label: string; href: string; words?: string; admin?: boolean }[] = [
  { label: "Home", href: "/", words: "start continue" },
  { label: "Library", href: "/library", words: "books shelf all" },
  { label: "Search", href: "/search", words: "find passage" },
  { label: "Paths", href: "/paths", words: "reading plans" },
  { label: "New path", href: "/paths/new", words: "create plan" },
  { label: "Import", href: "/import", words: "upload add audiobook epub pdf" },
  { label: "Reading stats", href: "/stats", words: "statistics time speed" },
  { label: "Your data", href: "/data", words: "export download backup removed notes" },
  { label: "Account", href: "/account", words: "password settings preferences profile" },
  { label: "Agent access", href: "/agents", words: "api tokens mcp claude" },
  { label: "Invite people", href: "/admin/invites", words: "readers invitations", admin: true },
  { label: "Spending", href: "/admin/costs", words: "costs caps money", admin: true },
];

const NOTE_TAG = { highlight: "Highlight", note: "Note", voice: "Voice note" } as const;

export const readerHref = (bookId: string, cfi?: string) => `/books/${bookId}/read${cfi ? `?at=${encodeURIComponent(cfi)}` : ""}`;

/** Every row the palette can show for this reader, before any query. */
export function buildItems(data: PaletteData | null, admin: boolean): PaletteItem[] {
  const items: PaletteItem[] = PAGES.filter((p) => admin || !p.admin).map((p) => ({
    key: `page:${p.href}`,
    kind: "page",
    label: p.label,
    tag: "Page",
    href: p.href,
    fields: [
      [p.label, 1],
      [p.words ?? "", 0.5],
    ],
  }));
  if (!data) return items;
  for (const b of data.books) {
    items.push({ key: `book:${b.id}`, kind: "book", label: b.title, detail: b.author || undefined, tag: "Book", href: `/books/${b.id}`, fields: [[b.title, 1], [b.author, 0.5]] });
  }
  // Straight into the reader, just below the book's own row when both match.
  for (const b of data.books.filter((x) => x.hasFile)) {
    items.push({ key: `read:${b.id}`, kind: "read", label: `Read ${b.title}`, detail: b.author || undefined, tag: "Reader", href: readerHref(b.id), fields: [[b.title, 0.98], [b.author, 0.49]] });
  }
  for (const p of data.paths) {
    items.push({ key: `path:${p.slug}`, kind: "path", label: p.title, tag: "Path", href: `/paths/${p.slug}`, fields: [[p.title, 1]] });
  }
  for (const p of data.paths) {
    for (const s of p.pillars) {
      items.push({ key: `pillar:${p.slug}:${s.slug}`, kind: "pillar", label: s.title, detail: p.title, tag: "Section", href: `/paths/${p.slug}#${s.anchor}`, fields: [[s.title, 0.9]] });
    }
  }
  const titles = new Map(data.books.map((b) => [b.id, b.title]));
  for (const n of data.notes) {
    items.push({ key: `note:${n.id}`, kind: "note", label: n.text, detail: titles.get(n.bookId), tag: NOTE_TAG[n.kind], href: readerHref(n.bookId, n.cfi), fields: [[n.text, 0.8]] });
  }
  return items;
}

const RECENT_BOOKS = 3;
const RECENT_NOTES = 3;
/** At most this many rows for a query (the search action comes after them). */
export const MAX_RESULTS = 40;

/** With nothing typed: books read lately (straight into the reader), the pages, the newest notes, then the Paths. */
function suggestions(items: PaletteItem[], data: PaletteData | null): PaletteItem[] {
  const opened = new Map((data?.books ?? []).map((b) => [b.id, b.openedAt]));
  const recent = items
    .filter((i) => i.kind === "read" && opened.get(i.key.slice("read:".length)))
    .sort((a, b) => (opened.get(b.key.slice(5)) ?? "").localeCompare(opened.get(a.key.slice(5)) ?? ""))
    .slice(0, RECENT_BOOKS);
  return [
    ...recent,
    ...items.filter((i) => i.kind === "page"),
    ...items.filter((i) => i.kind === "note").slice(0, RECENT_NOTES),
    ...items.filter((i) => i.kind === "path"),
  ];
}

/** The rows to show for `query`: the best matches first, then "Search the library for …". */
export function results(items: PaletteItem[], data: PaletteData | null, query: string): PaletteItem[] {
  const q = query.trim();
  if (!q) return suggestions(items, data);
  const found = rank(items, (i) => scoreFields(q, i.fields)).slice(0, MAX_RESULTS);
  return [...found, { key: "search", kind: "search", label: `Search the library for “${q}”`, tag: "Search", href: `/search?q=${encodeURIComponent(q)}`, fields: [] }];
}
