/**
 * M43 S2: a book's genealogy stored on the site. The skill (scripts/genealogy-on-subscription.ts `send`) reads the book
 * on the owner's Claude subscription and sends its checked result whole; this checks it again against the server's
 * own copy of the book before anything is stored:
 * - every link's paragraph must be one of this book's paragraphs, and its quote must be found in it (`findQuote`);
 * - a year from the book must come with words found in the paragraph named; otherwise the link keeps no year;
 * - a life event's order quote likewise; an event left with none of its links goes;
 * - the reading instructions must be this server's (the six prompt files, by their fingerprint).
 * One generation row per send (ground rule 5). The same send again stores nothing; a new one replaces the book's rows.
 *
 * Written for the sessions that build M43 S3 (the views in Study) on top of it.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { generationCacheKey } from "@/lib/ai/generate";
import { readPrompt, sha256 } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, genealogyEvents, genealogyLinks, generations, sections, type GenealogyKind } from "@/lib/db/schema";
import { RELATIONS } from "./genealogy";
import { findQuote } from "./xray-read";

export class GenealogyError extends Error {}

export const GENEALOGY_PROMPTS = ["genealogy-links", "genealogy-names", "genealogy-check", "genealogy-dates", "genealogy-life", "genealogy-years"] as const;

/** The fingerprint of the six reading instructions, in the order they run: a send read with others is refused. */
export async function genealogyPromptHash() {
  const files = await Promise.all(GENEALOGY_PROMPTS.map((p) => readPrompt(p)));
  return sha256(files.join("\n\u0000\n"));
}

/** One link as the skill sends it: `paragraph` is the section id of the paragraph its quote is in. */
export type SentLink = {
  from: string;
  from_kind: GenealogyKind;
  to: string;
  to_kind: GenealogyKind;
  relation: string;
  role?: string | null;
  paragraph: string;
  quote: string;
  removed?: boolean;
  check?: "holds" | "fix" | null;
  was?: string | null;
  why?: string | null;
  date?: { year: number; end_year?: number | null; paragraph: string; quote: string } | null;
};
/** One life event as sent: `links` and `date_links` are places in the sent list of links. */
export type SentEvent = {
  what: string;
  with: string;
  role?: string | null;
  links: number[];
  start_year?: number | null;
  end_year?: number | null;
  date_links?: number[];
  basis: "stated" | "worked_out" | "ordered" | "unknown";
  order?: { paragraph: string; quote: string } | null;
  why?: string | null;
  gk?: { start_year: number | null; end_year?: number | null; confidence: "high" | "medium"; note?: string | null } | null;
};
export type GenealogySend = { model: string; promptHash: string; links: SentLink[]; lives: Record<string, SentEvent[]> };

const MAX_LINKS = 20_000;
const BASES = ["stated", "worked_out", "ordered", "unknown"];
const KINDS = ["person", "organisation"];
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
const year = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1000 && (v as number) <= 2200 ? (v as number) : null);
const ords = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0) : []);

/** What a book's genealogy holds now: the send it came from, and how many of each. Null when it has none. */
export async function genealogyStatus(db: Db, ownerId: string, bookId: string) {
  await ownBook(db, ownerId, bookId);
  const [g] = await db
    .select({ id: generations.id, createdAt: generations.createdAt, model: generations.model })
    .from(generations)
    .where(and(eq(generations.bookId, bookId), eq(generations.ownerId, ownerId), eq(generations.kind, "genealogy")))
    .orderBy(desc(generations.createdAt))
    .limit(1);
  if (!g) return null;
  const links = await db.select({ removed: genealogyLinks.removed }).from(genealogyLinks).where(eq(genealogyLinks.generationId, g.id));
  const events = await db.select({ person: genealogyEvents.person }).from(genealogyEvents).where(eq(genealogyEvents.generationId, g.id));
  return { generationId: g.id, sentAt: g.createdAt.toISOString(), model: g.model, links: links.filter((l) => !l.removed).length, removed: links.filter((l) => l.removed).length, events: events.length, people: new Set(events.map((e) => e.person)).size };
}

async function ownBook(db: Db, ownerId: string, bookId: string) {
  const [book] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new GenealogyError("That book was not found.");
}

/** Stores a sent genealogy after checking it again here; returns what was stored and what was left out, and why. */
export async function saveGenealogy(db: Db, ownerId: string, bookId: string, input: GenealogySend, now = new Date()) {
  await ownBook(db, ownerId, bookId);
  if (!input || typeof input !== "object" || !Array.isArray(input.links) || !input.lives || typeof input.lives !== "object") throw new GenealogyError("The genealogy is missing its links or lives.");
  if (input.links.length > MAX_LINKS) throw new GenealogyError("That is more links than one book can hold.");
  if (typeof input.model !== "string" || !/^claude-[a-z0-9-]+$/.test(input.model)) throw new GenealogyError("The model must be a Claude model.");
  if (input.promptHash !== (await genealogyPromptHash())) throw new GenealogyError("It was read with other instructions than this server's prompts/genealogy-*.md.");
  const body = JSON.stringify({ links: input.links, lives: input.lives });
  const inputHash = sha256(body);
  const before = await genealogyStatus(db, ownerId, bookId);
  if (before) {
    const [g] = await db.select({ inputHash: generations.inputHash }).from(generations).where(eq(generations.id, before.generationId));
    if (g?.inputHash === inputHash) return { ...before, unchanged: true, dropped: {} as Record<string, number> };
  }

  // The book's paragraphs, by id, as this server holds them.
  const wanted = new Set<string>();
  for (const l of input.links) {
    if (typeof l?.paragraph === "string") wanted.add(l.paragraph);
    if (typeof l?.date?.paragraph === "string") wanted.add(l.date.paragraph);
  }
  for (const evs of Object.values(input.lives)) for (const e of Array.isArray(evs) ? evs : []) if (typeof e?.order?.paragraph === "string") wanted.add(e.order.paragraph);
  const paras = new Map<string, { text: string; chapterIndex: number; position: number }>();
  const ids = [...wanted];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ id: sections.id, text: sections.text, chapterIndex: sections.chapterIndex, position: sections.position })
      .from(sections)
      .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph"), inArray(sections.id, ids.slice(i, i + 500))));
    for (const r of rows) paras.set(r.id, r);
  }

  const dropped: Record<string, number> = {};
  const drop = (why: string) => (dropped[why] = (dropped[why] ?? 0) + 1);
  const linkRows: (typeof genealogyLinks.$inferInsert)[] = [];
  input.links.forEach((l, ord) => {
    const p = typeof l?.paragraph === "string" ? paras.get(l.paragraph) : undefined;
    const from = text(l?.from, 200);
    const to = text(l?.to, 200);
    if (!from || !to || !KINDS.includes(l.from_kind) || !KINDS.includes(l.to_kind) || !(RELATIONS as readonly string[]).includes(l.relation)) return drop("names, kinds or relation not known");
    if (!p) return drop("paragraph not in this book");
    const at = typeof l.quote === "string" ? findQuote(p.text, l.quote) : null;
    if (!at) return drop("quote not in its paragraph");
    let date: { year: number; end: number | null; id: string; start: number; end_at: number; quote: string } | null = null;
    const y = year(l.date?.year);
    if (l.date && y) {
      const dp = paras.get(l.date.paragraph);
      const dat = dp && typeof l.date.quote === "string" ? findQuote(dp.text, l.date.quote) : null;
      if (dp && dat) date = { year: y, end: year(l.date.end_year), id: l.date.paragraph, start: dat.start, end_at: dat.end, quote: dp.text.slice(dat.start, dat.end) };
      else drop("year's words not in their paragraph");
    }
    linkRows.push({
      bookId,
      generationId: "",
      ord,
      fromName: from,
      fromKind: l.from_kind,
      toName: to,
      toKind: l.to_kind,
      relation: l.relation,
      role: text(l.role, 120),
      removed: l.removed === true,
      verdict: l.check === "holds" || l.check === "fix" ? l.check : null,
      was: text(l.was, 400),
      why: text(l.why, 600),
      sectionId: l.paragraph,
      chapterIndex: p.chapterIndex,
      position: p.position,
      startAt: at.start,
      endAt: at.end,
      quote: p.text.slice(at.start, at.end),
      dateYear: date?.year ?? null,
      dateEndYear: date?.end ?? null,
      dateSectionId: date?.id ?? null,
      dateStartAt: date?.start ?? null,
      dateEndAt: date?.end_at ?? null,
      dateQuote: date?.quote ?? null,
    });
  });
  const shown = new Set(linkRows.filter((r) => !r.removed).map((r) => r.ord!));
  const dated = new Set(linkRows.filter((r) => r.dateYear != null).map((r) => r.ord!));

  const eventRows: (typeof genealogyEvents.$inferInsert)[] = [];
  for (const [person, evs] of Object.entries(input.lives)) {
    const name = text(person, 200);
    if (!name || !Array.isArray(evs)) continue;
    let ord = 0;
    for (const e of evs) {
      const links = ords(e?.links).filter((o) => shown.has(o));
      if (!links.length) {
        drop("life event with none of its links");
        continue;
      }
      const dateLinks = ords(e.date_links).filter((o) => dated.has(o));
      let start = year(e.start_year);
      let end = year(e.end_year);
      let basis = BASES.includes(e.basis) ? e.basis : "unknown";
      if ((start || end) && !dateLinks.length) {
        start = end = null;
        basis = "unknown";
        drop("life event's year with no dated link");
      }
      let order: { id: string; start: number; end: number; quote: string } | null = null;
      if (e.order) {
        const op = paras.get(e.order.paragraph);
        const oat = op && typeof e.order.quote === "string" ? findQuote(op.text, e.order.quote) : null;
        if (op && oat) order = { id: e.order.paragraph, start: oat.start, end: oat.end, quote: op.text.slice(oat.start, oat.end) };
        else drop("order quote not in its paragraph");
      }
      if ((basis === "ordered" || basis === "worked_out") && !order && !dateLinks.length) basis = "unknown";
      const gkStart = e.gk && (e.gk.confidence === "high" || e.gk.confidence === "medium") ? year(e.gk.start_year) : null;
      eventRows.push({
        bookId,
        generationId: "",
        person: name,
        ord: ord++,
        what: text(e.what, 40) ?? "linked",
        withName: text(e.with, 200) ?? "",
        role: text(e.role, 120),
        linkOrds: links,
        startYear: start,
        endYear: end,
        dateLinkOrds: dateLinks,
        basis: basis as "stated" | "worked_out" | "ordered" | "unknown",
        orderSectionId: order?.id ?? null,
        orderStartAt: order?.start ?? null,
        orderEndAt: order?.end ?? null,
        orderQuote: order?.quote ?? null,
        why: text(e.why, 600),
        gkStartYear: gkStart,
        gkEndYear: gkStart ? year(e.gk?.end_year) : null,
        gkConfidence: gkStart ? e.gk!.confidence : null,
        gkNote: e.gk ? text(e.gk.note, 400) : null,
      });
    }
  }

  const generationId = await db.transaction(async (tx) => {
    const [g] = await tx
      .insert(generations)
      .values({
        ownerId,
        bookId,
        sectionId: null,
        kind: "genealogy",
        options: {},
        cacheKey: generationCacheKey("genealogy", {}, input.promptHash, inputHash),
        provider: "claude-subscription",
        model: input.model,
        promptName: "genealogy",
        promptHash: input.promptHash,
        inputHash,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        output: body,
        createdAt: now,
      })
      .returning({ id: generations.id });
    await tx.delete(genealogyEvents).where(eq(genealogyEvents.bookId, bookId));
    await tx.delete(genealogyLinks).where(eq(genealogyLinks.bookId, bookId));
    for (let i = 0; i < linkRows.length; i += 500) await tx.insert(genealogyLinks).values(linkRows.slice(i, i + 500).map((r) => ({ ...r, generationId: g.id })));
    for (let i = 0; i < eventRows.length; i += 500) await tx.insert(genealogyEvents).values(eventRows.slice(i, i + 500).map((r) => ({ ...r, generationId: g.id })));
    return g.id;
  });
  return { generationId, sentAt: now.toISOString(), model: input.model, links: shown.size, removed: linkRows.length - shown.size, events: eventRows.length, people: new Set(eventRows.map((e) => e.person)).size, unchanged: false, dropped };
}

/** A book's genealogy in the order the views need: links by place in the list, events by person and order. */
export async function readGenealogy(db: Db, ownerId: string, bookId: string) {
  const status = await genealogyStatus(db, ownerId, bookId);
  if (!status) return null;
  const links = await db.select().from(genealogyLinks).where(eq(genealogyLinks.bookId, bookId)).orderBy(asc(genealogyLinks.ord));
  const events = await db.select().from(genealogyEvents).where(eq(genealogyEvents.bookId, bookId)).orderBy(asc(genealogyEvents.person), asc(genealogyEvents.ord));
  return { status, links, events };
}
