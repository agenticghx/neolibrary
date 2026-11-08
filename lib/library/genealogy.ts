/**
 * M43 S1: the checks behind a book's genealogy (who founded, led, worked at, left, bought, funded or supplied whom),
 * read chapter by chapter on the owner's Claude subscription by scripts/genealogy-on-subscription.ts.
 *
 * Written for the sessions that run or change the genealogy skill (.claude/skills/genealogy-on-subscription/SKILL.md).
 * Every answer from Claude passes through one of these before it is kept, and none of them calls Claude:
 * - a link's quote must be found word for word in the paragraph it names (the X-ray's own `findQuote`);
 * - the second reading may keep, correct or remove a link, and a correction must name the same two names;
 * - the names reading may only group names that were read, and set aside vague groups;
 * - a year must come with words, found in the chapter, that give it;
 * - a life event's year must rest on a checked year, and its place in the order on a quote found in its paragraph.
 */
import { findQuote } from "./xray-read";

export const RELATIONS = ["founded", "worked_at", "led", "left", "advised", "spun_out_of", "acquired", "bought_part_of", "part_of", "funded", "supplied", "partnered", "mentored", "hired", "worked_for", "friend", "family"] as const;
export type Relation = (typeof RELATIONS)[number];
export type Kind = "person" | "organisation";

/** One chapter as read: its paragraphs in order (passage n is paragraphs[n - 1]). */
export type Chapter = { number: number; title: string; paragraphs: { id: string; text: string }[] };

export type Link = {
  from: string;
  from_kind: Kind;
  to: string;
  to_kind: Kind;
  relation: Relation;
  role: string | null;
  year: number | null;
  chapter: number;
  passage: number;
  paragraph: string;
  quote: string;
  note: string | null;
};

/**
 * The last JSON object in an answer that has `key`. A model that corrects itself sends a second object after the
 * first ("Correction: …"); the later one is its final word. Null when there is none.
 */
export function lastObject(text: string, key: string): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let start = -1;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"' && depth > 0) inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0 && --depth === 0) {
      try {
        const obj = JSON.parse(text.slice(start, i + 1));
        if (obj && typeof obj === "object" && !Array.isArray(obj) && key in obj) best = obj;
      } catch {
        // braces in prose, not an object
      }
    }
  }
  return best;
}

const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
};
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
const kind = (v: unknown): Kind | null => (v === "person" || v === "organisation" ? v : v === "organization" ? "organisation" : null);
const year = (v: unknown): number | null => {
  const n = int(v);
  return n !== null && n >= 1000 && n <= 2200 ? n : null;
};

/** A chapter's first-reading answer, checked: links whose quote is in the paragraph they name, and the rest with why. */
export function checkLinks(answer: string, ch: Chapter): { kept: Link[]; dropped: { link: unknown; why: string }[] } {
  const obj = lastObject(answer, "links");
  const raw = Array.isArray(obj?.links) ? (obj.links as Record<string, unknown>[]) : [];
  const kept: Link[] = [];
  const dropped: { link: unknown; why: string }[] = [];
  for (const r of raw) {
    const passage = int(r?.passage);
    const from = str(r?.from, 120);
    const to = str(r?.to, 120);
    const fk = kind(r?.from_kind);
    const tk = kind(r?.to_kind);
    const relation = RELATIONS.find((x) => x === r?.relation);
    const quote = typeof r?.quote === "string" ? r.quote : "";
    const para = passage !== null && passage >= 1 && passage <= ch.paragraphs.length ? ch.paragraphs[passage - 1] : null;
    const why = !from || !to || !fk || !tk ? "names or kinds missing" : !relation ? `relation not in the list: ${String(r?.relation)}` : from === to ? "a name linked to itself" : !para ? "no such paragraph" : null;
    if (why) {
      dropped.push({ link: r, why });
      continue;
    }
    const at = findQuote(para!.text, quote);
    if (!at) {
      dropped.push({ link: r, why: "quote not in the paragraph" });
      continue;
    }
    kept.push({ from: from!, from_kind: fk!, to: to!, to_kind: tk!, relation: relation!, role: str(r.role, 80), year: year(r.year), chapter: ch.number, passage: passage!, paragraph: para!.id, quote: para!.text.slice(at.start, at.end), note: str(r.note) });
  }
  return { kept, dropped };
}

/**
 * The names reading, checked: each group keeps one name and folds in the others, all of which must have been read;
 * a name in two groups stays in the first. Vague names must have been read too.
 */
export function readNames(answer: string, names: Iterable<string>): { alias: Map<string, string>; vague: Set<string>; ignored: number } {
  const known = new Set(names);
  const obj = lastObject(answer, "same");
  const alias = new Map<string, string>();
  const vague = new Set<string>();
  let ignored = 0;
  for (const g of Array.isArray(obj?.same) ? (obj.same as Record<string, unknown>[]) : []) {
    const keep = typeof g?.name === "string" ? g.name : "";
    if (!known.has(keep) || alias.has(keep)) {
      ignored++;
      continue;
    }
    for (const o of Array.isArray(g.others) ? g.others : []) {
      if (typeof o === "string" && known.has(o) && o !== keep && !alias.has(o) && ![...alias.values()].includes(o)) alias.set(o, keep);
      else ignored++;
    }
  }
  for (const v of Array.isArray(obj?.vague) ? obj.vague : []) {
    if (typeof v === "string" && known.has(v)) vague.add(v);
    else ignored++;
  }
  return { alias, vague, ignored };
}

/** Links with one spelling per name; a link to a vague group, or one that now links a name to itself, goes. */
export function mergeNames(links: Link[], alias: Map<string, string>, vague: Set<string>): { links: Link[]; removed: number } {
  const out: Link[] = [];
  let removed = 0;
  for (const l of links) {
    const from = alias.get(l.from) ?? l.from;
    const to = alias.get(l.to) ?? l.to;
    if (vague.has(l.from) || vague.has(l.to) || from === to) removed++;
    else out.push({ ...l, from, to });
  }
  return { links: out, removed };
}

export type Checked = Link & { check?: "holds" | "fix"; was?: string; why?: string | null };

/**
 * The second reading applied. holds: kept. fix: the corrected link written out in full, which must name the same two
 * names (in either order) and a relation from the list; otherwise the link is removed, as an unsupported one is. A
 * link with no verdict is kept as it was.
 */
export function applyChecks(links: Link[], answers: Map<number, Record<string, unknown>>, alias = new Map<string, string>()) {
  const kept: Checked[] = [];
  const removed: (Link & { why: string | null })[] = [];
  const counts = { holds: 0, fixed: 0, unsupported: 0, fix_unusable: 0, unchecked: 0 };
  links.forEach((l, i) => {
    const c = answers.get(i);
    if (!c) {
      counts.unchecked++;
      kept.push(l);
      return;
    }
    const why = str(c.why);
    if (c.verdict === "holds") {
      counts.holds++;
      kept.push({ ...l, check: "holds", why });
      return;
    }
    if (c.verdict === "fix") {
      const k = (c.link ?? {}) as Record<string, unknown>;
      const f = typeof k.from === "string" ? (alias.get(k.from) ?? k.from) : "";
      const t = typeof k.to === "string" ? (alias.get(k.to) ?? k.to) : "";
      const relation = RELATIONS.find((x) => x === k.relation);
      const same = (f === l.from && t === l.to) || (f === l.to && t === l.from);
      if (!same || !relation) {
        counts.fix_unusable++;
        removed.push({ ...l, why });
        return;
      }
      const swapped = f !== l.from;
      const fixed: Checked = swapped ? { ...l, from: l.to, from_kind: l.to_kind, to: l.from, to_kind: l.from_kind, relation } : { ...l, relation };
      const before = `${l.from} ${l.relation} ${l.to}`;
      if (`${fixed.from} ${fixed.relation} ${fixed.to}` !== before) fixed.was = before;
      counts.fixed++;
      kept.push({ ...fixed, check: "fix", why });
      return;
    }
    counts.unsupported++;
    removed.push({ ...l, why });
  });
  return { kept, removed, counts };
}

export type DateAnswer = { id: number; year: number | null; end_year: number | null; basis: string; passage: number | null; quote: string | null; after: number | null; checked: boolean };

/** A chapter's dates, checked: a year counts only with words found, word for word, in the paragraph named. */
export function checkDates(answer: string, ch: Chapter, ids: Set<number>): DateAnswer[] {
  const obj = lastObject(answer, "dates");
  const out: DateAnswer[] = [];
  for (const d of Array.isArray(obj?.dates) ? (obj.dates as Record<string, unknown>[]) : []) {
    const id = int(d?.id);
    if (id === null || !ids.has(id)) continue;
    const y = year(d.year);
    const p = int(d.date_passage);
    const q = typeof d.date_quote === "string" ? d.date_quote : "";
    const para = p !== null && p >= 1 && p <= ch.paragraphs.length ? ch.paragraphs[p - 1] : null;
    const at = y !== null && para ? findQuote(para.text, q) : null;
    out.push({ id, year: at ? y : null, end_year: at ? year(d.end_year) : null, basis: at ? String(d.basis ?? "stated") : "none", passage: at ? p : null, quote: at && para ? para.text.slice(at.start, at.end) : null, after: int(d.after), checked: !!at });
  }
  return out;
}

export type LifeEvent = {
  what: string;
  with: string;
  role: string | null;
  links: number[];
  start_year: number | null;
  end_year: number | null;
  date_ids: number[];
  basis: "stated" | "worked_out" | "ordered" | "unknown";
  order_quote: string | null;
  order_chapter: number | null;
  order_passage: number | null;
  why: string | null;
};

/**
 * One person's life events, checked. Links and dated facts must be ones the reading was given. A year with no dated
 * fact behind it is taken away; an order quote must be found in the paragraph it names (`paragraph(chapter, passage)`).
 * An event placed by order with neither is "unknown". Events with no links left go.
 */
export function checkLife(answer: string, linkIds: Set<number>, facts: Map<number, number>, paragraph: (chapter: number, passage: number) => string | null) {
  const obj = lastObject(answer, "events");
  const dropped = { year_without_fact: 0, order_quote_not_found: 0 };
  const events: LifeEvent[] = [];
  const ids = (v: unknown, prefix: string, ok: (n: number) => boolean) =>
    (Array.isArray(v) ? v : []).map((x) => int(String(x).replace(prefix, ""))).filter((n): n is number => n !== null && ok(n));
  for (const e of Array.isArray(obj?.events) ? (obj.events as Record<string, unknown>[]) : []) {
    const links = ids(e?.links, "L", (n) => linkIds.has(n));
    if (!links.length) continue;
    const date_ids = ids(e.date_ids, "D", (n) => facts.has(n));
    let start = year(e.start_year);
    let end = year(e.end_year);
    let basis = (["stated", "worked_out", "ordered", "unknown"].includes(String(e.basis)) ? e.basis : "unknown") as LifeEvent["basis"];
    if ((start || end) && !date_ids.length) {
      start = end = null;
      basis = "unknown";
      dropped.year_without_fact++;
    }
    if (basis === "stated" && start && !date_ids.some((d) => facts.get(d) === start)) basis = "worked_out";
    let q = typeof e.order_quote === "string" && e.order_quote.trim() ? e.order_quote : null;
    const oc = int(e.order_chapter);
    const op = int(e.order_passage);
    let quote: string | null = null;
    if (q) {
      const text = oc !== null && op !== null ? paragraph(oc, op) : null;
      const at = text ? findQuote(text, q) : null;
      if (at && text) quote = text.slice(at.start, at.end);
      else dropped.order_quote_not_found++;
      q = quote;
    }
    if ((basis === "ordered" || basis === "worked_out") && !quote && !date_ids.length) basis = "unknown";
    events.push({ what: String(e.what ?? ""), with: String(e.with ?? ""), role: str(e.role, 80), links, start_year: start, end_year: end, date_ids, basis, order_quote: quote, order_chapter: quote ? oc : null, order_passage: quote ? op : null, why: str(e.why) });
  }
  return { events, dropped };
}

/** Years from general knowledge, for events the book leaves undated only: never one the book dates. */
export function checkYears(answer: string, events: { start_year: number | null }[]) {
  const obj = lastObject(answer, "years");
  const out: { i: number; start_year: number | null; end_year: number | null; confidence: "high" | "medium"; note: string | null }[] = [];
  for (const y of Array.isArray(obj?.years) ? (obj.years as Record<string, unknown>[]) : []) {
    const i = int(y?.i);
    if (i === null || i < 0 || i >= events.length || events[i].start_year) continue;
    const confidence = y.confidence === "high" ? "high" : y.confidence === "medium" ? "medium" : null;
    const start = confidence ? year(y.start_year) : null;
    const note = str(y.note);
    if (!start && !note) continue;
    out.push({ i, start_year: start, end_year: start ? year(y.end_year) : null, confidence: confidence ?? "medium", note });
  }
  return out;
}

/** "Morris Chang" → "Morris-Chang": a file name for a person's reading. */
export const slug = (name: string) => name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
