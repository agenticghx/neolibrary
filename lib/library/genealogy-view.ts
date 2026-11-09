/**
 * M43 S3: a book's stored genealogy as the Genealogy views draw it. Written for Claude sessions working on the
 * Genealogy tab; Samuel reads the tab, not this.
 *
 * The rows saved by S2 (genealogy-store.ts) refer to the book by paragraph id. The views think in chapters 1, 2, 3…
 * (the slider, the timelines), so this numbers the chapters by the same rule as the laptop skill (numberChapters)
 * and gives every quote its place in the book (a CFI, so "Go to the passage" can turn the reader's page there).
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { numberChapters } from "./genealogy";
import { readGenealogy } from "./genealogy-store";
import { positionAt } from "./xray";

export type GenealogyViewKind = "person" | "organisation";
/** One link the book states, with the sentence it rests on. `chapter` is the view's chapter number (1…n). */
export type GenealogyViewLink = {
  from: string;
  from_kind: GenealogyViewKind;
  to: string;
  to_kind: GenealogyViewKind;
  relation: string;
  role: string | null;
  chapter: number;
  quote: string;
  cfi: string | null;
  /** The second reading's verdict: "fix" when it corrected the first reading, which `was` keeps. */
  check: "holds" | "fix" | null;
  was: string | null;
  why: string | null;
  year: number | null;
};
/** One step in a person's life. `links` and `date_ids` are places in `links`. */
export type GenealogyViewEvent = {
  what: string;
  with: string;
  role: string | null;
  links: number[];
  start_year: number | null;
  end_year: number | null;
  date_ids: number[];
  basis: "stated" | "worked_out" | "ordered" | "unknown";
  order_chapter: number | null;
  order_quote: string | null;
  order_cfi: string | null;
  why: string | null;
  /** Years from Claude's general knowledge, never the book's: drawn in purple, and switchable. */
  gk: { start_year: number | null; end_year: number | null; confidence: "high" | "medium" | null; note: string | null } | null;
};
export type GenealogyView = {
  book: string;
  /** Chapters, numbered 1…n, with their titles. */
  n: number;
  chapters: Record<number, string>;
  /** [first chapter, its name ("I", "II"…), its title]. */
  parts: [number, string, string][];
  /** The chapter the reader is in (1 before the first numbered chapter). */
  at: number;
  /** Who made it: the model and when it was sent (ground rule: AI output carries its provenance). */
  model: string;
  sentAt: string;
  nodes: Record<string, GenealogyViewKind>;
  links: GenealogyViewLink[];
  /** Links the second reading removed: each had a real quote that does not say the link. */
  doubted: GenealogyViewLink[];
  lives: Record<string, GenealogyViewEvent[]>;
  dates: Record<number, { year: number; end_year: number | null; quote: string; chapter: number; cfi: string | null }>;
  top: { tree: string[]; org: string[]; person: string[] };
};

/** The book's genealogy for its owner, or null when none has been sent. `cfi` is where the reader is. */
export async function genealogyView(db: Db, ownerId: string, bookId: string, cfi: string | null): Promise<GenealogyView | null> {
  const stored = await readGenealogy(db, ownerId, bookId);
  if (!stored) return null;
  const [book] = await db.select({ title: books.title }).from(books).where(eq(books.id, bookId));

  // The chapters, numbered as the skill numbers them: their prose length decides which count.
  const heads = await db
    .select({ index: sections.chapterIndex, label: sections.label, position: sections.position })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "chapter")))
    .orderBy(asc(sections.position));
  const sizes = await db
    .select({ index: sections.chapterIndex, size: sql<number>`coalesce(sum(length(regexp_replace(btrim(${sections.text}), '\\s+', ' ', 'g'))), 0)::int` })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph"), ne(sections.form, "equation")))
    .groupBy(sections.chapterIndex);
  const sizeOf = new Map(sizes.map((s) => [s.index, s.size]));
  const { chapters, parts } = numberChapters(heads.map((h) => ({ ...h, size: sizeOf.get(h.index) ?? 0 })));
  // A chapter index the numbering left out (a short page with a link on it) counts as the next numbered chapter.
  const numberOf = (index: number) => (chapters.find((c) => c.index >= index) ?? chapters[chapters.length - 1])?.number ?? 1;

  // Where each quote is, to go there.
  const ids = new Set<string>();
  for (const l of stored.links) {
    ids.add(l.sectionId);
    if (l.dateSectionId) ids.add(l.dateSectionId);
  }
  for (const e of stored.events) if (e.orderSectionId) ids.add(e.orderSectionId);
  const place = new Map<string, { cfi: string; chapterIndex: number }>();
  const list = [...ids];
  for (let i = 0; i < list.length; i += 500) {
    const rows = await db
      .select({ id: sections.id, cfi: sections.cfi, chapterIndex: sections.chapterIndex })
      .from(sections)
      .where(and(eq(sections.bookId, bookId), inArray(sections.id, list.slice(i, i + 500))));
    for (const r of rows) place.set(r.id, r);
  }

  const shape = (l: (typeof stored.links)[number]): GenealogyViewLink => ({
    from: l.fromName,
    from_kind: l.fromKind,
    to: l.toName,
    to_kind: l.toKind,
    relation: l.relation,
    role: l.role,
    chapter: numberOf(l.chapterIndex),
    quote: l.quote,
    cfi: place.get(l.sectionId)?.cfi ?? null,
    check: l.verdict,
    was: l.was,
    why: l.why,
    year: l.dateYear,
  });
  const kept = stored.links.filter((l) => !l.removed);
  const links = kept.map(shape);
  const doubted = stored.links.filter((l) => l.removed).map(shape);
  // Events refer to links by their place in the sent list (ord); the views by their place in `links`.
  const at = new Map(kept.map((l, i) => [l.ord, i]));
  const dates: GenealogyView["dates"] = {};
  kept.forEach((l, i) => {
    if (l.dateYear == null || !l.dateQuote) return;
    const p = l.dateSectionId ? place.get(l.dateSectionId) : undefined;
    dates[i] = { year: l.dateYear, end_year: l.dateEndYear, quote: l.dateQuote, chapter: p ? numberOf(p.chapterIndex) : links[i].chapter, cfi: p?.cfi ?? null };
  });
  const lives: GenealogyView["lives"] = {};
  for (const e of stored.events) {
    const mine = e.linkOrds.map((o) => at.get(o)).filter((i): i is number => i !== undefined);
    if (!mine.length) continue;
    const op = e.orderSectionId ? place.get(e.orderSectionId) : undefined;
    (lives[e.person] ??= []).push({
      what: e.what,
      with: e.withName,
      role: e.role,
      links: mine,
      start_year: e.startYear,
      end_year: e.endYear,
      date_ids: e.dateLinkOrds.map((o) => at.get(o)).filter((i): i is number => i !== undefined),
      basis: e.basis,
      order_chapter: op ? numberOf(op.chapterIndex) : null,
      order_quote: e.orderQuote,
      order_cfi: op?.cfi ?? null,
      why: e.why,
      gk: e.gkStartYear || e.gkNote ? { start_year: e.gkStartYear, end_year: e.gkEndYear, confidence: e.gkConfidence, note: e.gkNote } : null,
    });
  }

  // Each name's kind: the one most of its links give it.
  const votes = new Map<string, Map<GenealogyViewKind, number>>();
  for (const l of [...links, ...doubted])
    for (const [n, k] of [
      [l.from, l.from_kind],
      [l.to, l.to_kind],
    ] as const) {
      const m = votes.get(n) ?? new Map<GenealogyViewKind, number>();
      m.set(k, (m.get(k) ?? 0) + 1);
      votes.set(n, m);
    }
  const nodes = Object.fromEntries([...votes].map(([n, m]) => [n, [...m].sort((x, y) => y[1] - x[1])[0][0]]));
  const count = new Map<string, number>();
  for (const l of links) for (const n of [l.from, l.to]) count.set(n, (count.get(n) ?? 0) + 1);
  const top = (pred: (n: string) => boolean) =>
    [...count]
      .filter(([n]) => pred(n))
      .sort((x, y) => y[1] - x[1])
      .map(([n]) => n)
      .slice(0, 8);
  const lineage = new Set(links.filter((l) => l.from_kind === "organisation" && l.to_kind === "organisation" && ["spun_out_of", "acquired", "part_of"].includes(l.relation)).flatMap((l) => [l.from, l.to]));

  // The reader's chapter: the last numbered chapter that starts at or before their place.
  const position = await positionAt(db, bookId, cfi);
  const reached = chapters.filter((c) => c.position <= position);
  return {
    book: book?.title ?? "This book",
    n: chapters.length,
    chapters: Object.fromEntries(chapters.map((c) => [c.number, c.title])),
    parts,
    at: reached.length ? reached[reached.length - 1].number : 1,
    model: stored.status.model,
    sentAt: stored.status.sentAt,
    nodes,
    links,
    doubted,
    lives,
    dates,
    top: { tree: top((n) => nodes[n] === "organisation" && lineage.has(n)), org: top((n) => nodes[n] === "organisation"), person: top((n) => nodes[n] === "person") },
  };
}
