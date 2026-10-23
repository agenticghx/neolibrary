import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { capsFromEnv, estimateCost, generate, spendingWithJobs, SpendingCapReached, type Caps, type GenerationRequest } from "@/lib/ai/generate";
import { AiError, type TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, generations, sections, xrayEntries, xrayFacts, type XrayKind } from "@/lib/db/schema";
import { getStyles } from "./ai-style";
import { bookLine, styleInstruction } from "./prerequisites";
import { BOILERPLATE, findMentions, paragraphsOf, saveMentions, XrayError, type XrayEntry } from "./xray";

/**
 * X-ray, read by Claude (M32 X3). One call per chapter, in order, each told
 * the entries known so far, so a new form of an old name joins its entry.
 * Claude returns the chapter's entries, their kinds and other names, and
 * facts: short statements, each with the quote it rests on. The quote check
 * is the spine: a fact whose quote is not found word for word in the passage
 * it names is dropped and counted, never stored (ground rule 4 made a rule of
 * honesty). Facts are stored per chapter, so a card can show only what the
 * reader has reached. Stored once per chapter and style like every AI answer
 * (ground rule 5), shared like rewrites (rule 6), paid under the caps (rule 8).
 */
export const KINDS: XrayKind[] = ["person", "place", "organisation", "term", "work", "event"];
const MAX_CHARS = 60_000;
const MAX_TOKENS = 8000;
const MAX_FACTS = 5;
const MAX_FACT_CHARS = 300;
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

export const SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: KINDS },
          aliases: { type: "array", items: { type: "string" } },
          same_as: { type: ["string", "null"], description: "The known entry this is, by its name; else null." },
          facts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                passage: { type: "integer" },
                fact: { type: "string", description: "One short sentence." },
                quote: { type: "string", description: "Copied exactly from that passage." },
              },
              required: ["passage", "fact", "quote"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "kind", "aliases", "same_as", "facts"],
        additionalProperties: false,
      },
    },
  },
  required: ["entries"],
  additionalProperties: false,
};

export type Passage = { n: number; id: string; position: number; chapterIndex: number; cfi: string; text: string };
export type Chapter = { id: string; label: string; chapterIndex: number; position: number };

/** The book's own chapters, in order (a publisher's pages at either end left out, as the index leaves them out). */
export async function bookChapters(db: Db, bookId: string): Promise<Chapter[]> {
  const rows = await db
    .select({ id: sections.id, label: sections.label, href: sections.href, chapterIndex: sections.chapterIndex, position: sections.position })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "chapter")))
    .orderBy(asc(sections.position));
  return rows.filter((c) => !BOILERPLATE.test(c.label) && !BOILERPLATE.test(c.href)).map(({ id, label, chapterIndex, position }) => ({ id, label, chapterIndex, position }));
}

/** A chapter's paragraphs, numbered from 1, cut where the chapter passes the length the cost allows. */
export async function chapterPassages(db: Db, bookId: string, chapterIndex: number): Promise<Passage[]> {
  const rows = await db
    .select({ id: sections.id, position: sections.position, chapterIndex: sections.chapterIndex, cfi: sections.cfi, text: sections.text })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.chapterIndex, chapterIndex), eq(sections.kind, "paragraph")))
    .orderBy(asc(sections.position));
  const out: Passage[] = [];
  let chars = 0;
  for (const r of rows) {
    if (!r.text.trim()) continue;
    chars += r.text.length;
    if (chars > MAX_CHARS && out.length) break;
    out.push({ n: out.length + 1, ...r });
  }
  return out;
}

export const passagesBlock = (passages: Passage[]) => passages.map((p) => `<passage n="${p.n}">\n${p.text}\n</passage>`).join("\n\n");
export const knownBlock = (known: XrayEntry[]) => (known.length ? known.map((e) => `${e.name} (${e.kind === "name" ? "not yet classified" : e.kind}): ${e.aliases.join(", ")}`).join("\n") : "(none yet)");

/** The request for one chapter: what the model is sent, and what the stored answer is keyed by. */
export async function buildRequest(db: Db, ownerId: string, bookId: string, chapter: Chapter, passages: Passage[], known: XrayEntry[]): Promise<GenerationRequest> {
  const file = await readPrompt("xray");
  const { system, user } = splitPrompt(file);
  const { effective: style } = await getStyles(db, ownerId, bookId);
  const instruction = await styleInstruction(style);
  const text = passages.map((p) => p.text).join("\n\n");
  return {
    ownerId,
    bookId,
    sectionId: chapter.id,
    kind: "xray",
    // Keyed by the chapter's text and the style only: the known list changes as chapters are read, and a stored
    // answer still joins its names to the right entries by name when it is read again (checkAnswer).
    options: { style },
    promptName: `xray${instruction.promptSuffix}`,
    promptHash: sha256(`${file}\n\n${instruction.text}`),
    input: text,
    system: fill(system, { style: instruction.text }),
    prompt: fill(user, { book: await bookLine(db, bookId), chapter: chapter.label, known: knownBlock(known), passages: passagesBlock(passages) }),
    maxTokens: MAX_TOKENS,
    effort: "medium",
    schema: SCHEMA,
  };
}

/**
 * Where a quote lies in a text, as offsets into it: exactly, or else with the
 * differences that are not the words (curly against straight quotes, a dash
 * written three ways, runs of space, capitals) set aside. Null when the words
 * are not there.
 */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim();
  if (!q) return null;
  const exact = text.indexOf(q);
  if (exact >= 0) return { start: exact, end: exact + q.length };
  const fold = (c: string) => {
    if (/[‘’‚‛']/u.test(c)) return "'";
    if (/[“”„‟"]/u.test(c)) return '"';
    if (/[‐-―−-]/u.test(c)) return "-";
    if (/\s/u.test(c)) return " ";
    return c.toLowerCase();
  };
  const norm: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = fold(text[i]);
    const last = norm[norm.length - 1];
    // Runs of space become one; a space beside a dash goes ("had—the" and "had - the" are the same words).
    if (c === " " && (last === " " || last === "-")) continue;
    if (c === "-" && last === " ") {
      norm.pop();
      at.pop();
    }
    norm.push(c);
    at.push(i);
  }
  const needle = [...q].map(fold).join("").replace(/ +/g, " ").replace(/ ?- ?/g, "-").trim();
  if (!needle) return null;
  const pos = norm.join("").indexOf(needle);
  if (pos < 0) return null;
  return { start: at[pos], end: at[pos + needle.length - 1] + 1 };
}

export type CheckedFact = { sectionId: string; position: number; chapterIndex: number; start: number; end: number; fact: string; quote: string };
export type CheckedEntry = { id: string; name: string; kind: XrayKind; aliases: string[]; isNew: boolean; facts: CheckedFact[] };

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;

/**
 * Claude's answer, checked against the passages and the entries known so far.
 * An entry that names a known one (same_as), or shares a name with one, joins
 * it; any other is new. A fact's quote must be found in the passage it names,
 * or the fact is dropped; `dropped` counts them.
 */
export function checkAnswer(output: string, passages: Passage[], known: XrayEntry[]): { entries: CheckedEntry[]; dropped: number } {
  let raw: { name?: unknown; kind?: unknown; aliases?: unknown; same_as?: unknown; facts?: unknown }[] = [];
  try {
    raw = (JSON.parse(output) as { entries?: typeof raw }).entries ?? [];
  } catch {
    return { entries: [], dropped: 0 };
  }
  if (!Array.isArray(raw)) return { entries: [], dropped: 0 };
  const byN = new Map(passages.map((p) => [p.n, p]));
  const findKnown = (names: string[]) => known.find((k) => names.some((n) => same(n, k.name) || k.aliases.some((a) => same(a, n))));
  const entries: CheckedEntry[] = [];
  let dropped = 0;
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const name = clean(r.name, 120);
    if (!name) continue;
    const kind = (KINDS as string[]).includes(String(r.kind)) ? (r.kind as XrayKind) : "term";
    const aliases = [...new Set([name, ...(Array.isArray(r.aliases) ? r.aliases.map((a) => clean(a, 120)) : [])].filter(Boolean))];
    const sameAs = clean(r.same_as, 120);
    const names = sameAs ? [sameAs, ...aliases] : aliases;
    const earlier = entries.find((e) => e.aliases.some((a) => names.some((b) => same(a, b))));
    const target = findKnown(names);
    const facts: CheckedFact[] = [];
    for (const f of Array.isArray(r.facts) ? (r.facts as { passage?: unknown; fact?: unknown; quote?: unknown }[]) : []) {
      if (facts.length === MAX_FACTS) break;
      const p = typeof f?.passage === "number" ? byN.get(f.passage) : undefined;
      const fact = clean(f?.fact, MAX_FACT_CHARS);
      const where = p && typeof f?.quote === "string" ? findQuote(p.text, f.quote) : null;
      if (!p || !fact || !where) {
        dropped += 1;
        continue;
      }
      facts.push({ sectionId: p.id, position: p.position, chapterIndex: p.chapterIndex, start: where.start, end: where.end, fact, quote: p.text.slice(where.start, where.end) });
    }
    if (earlier) {
      // Two answers for one entry in the same chapter: one entry.
      earlier.aliases = [...new Set([...earlier.aliases, ...aliases])];
      earlier.facts = [...earlier.facts, ...facts].slice(0, MAX_FACTS);
      continue;
    }
    entries.push({
      id: target?.id ?? `x-${hash(name.toLowerCase())}`,
      name,
      kind,
      aliases: target ? [...new Set([...target.aliases, ...aliases])] : aliases,
      isNew: !target,
      facts,
    });
  }
  return { entries, dropped };
}

/** Stores a checked answer: entries joined or added, this answer's facts (replacing its earlier ones), mentions rebuilt for the names that changed. */
export async function applyChapter(db: Db, bookId: string, generationId: string, checked: { entries: CheckedEntry[] }) {
  const existing = new Map((await db.select().from(xrayEntries).where(eq(xrayEntries.bookId, bookId))).map((e) => [e.id, e]));
  const changed: XrayEntry[] = [];
  await db.transaction(async (tx) => {
    for (const e of checked.entries) {
      const old = existing.get(e.id);
      if (old) {
        const aliases = [...new Set([...old.aliases, ...e.aliases])];
        // A name found in the text alone takes Claude's name and kind; one Claude has read keeps them.
        const fromText = old.kind === "name";
        const row = { name: fromText ? e.name : old.name, kind: fromText ? e.kind : old.kind, aliases, generationId: old.generationId ?? generationId };
        await tx.update(xrayEntries).set(row).where(and(eq(xrayEntries.bookId, bookId), eq(xrayEntries.id, e.id)));
        if (aliases.length !== old.aliases.length) changed.push({ id: e.id, name: row.name, kind: row.kind, aliases });
      } else {
        await tx.insert(xrayEntries).values({ bookId, id: e.id, name: e.name, kind: e.kind, aliases: e.aliases, generationId });
        changed.push({ id: e.id, name: e.name, kind: e.kind, aliases: e.aliases });
      }
    }
    await tx.delete(xrayFacts).where(eq(xrayFacts.generationId, generationId));
    const facts = checked.entries.flatMap((e) => e.facts.map((f) => ({ bookId, entryId: e.id, generationId, chapterIndex: f.chapterIndex, sectionId: f.sectionId, position: f.position, startAt: f.start, endAt: f.end, fact: f.fact, quote: f.quote })));
    for (let i = 0; i < facts.length; i += 500) await tx.insert(xrayFacts).values(facts.slice(i, i + 500));
  });
  if (changed.length) {
    // Every name's mentions again, together (a span goes to the longest name), on the same paragraphs the index
    // reads: the same result a rebuild from the entries alone gives.
    await saveMentions(db, bookId, findMentions(await db_entries(db, bookId), await paragraphsOf(db, bookId)));
  }
  return { entries: checked.entries.length, facts: checked.entries.reduce((n, e) => n + e.facts.length, 0), changed: changed.length };
}

export type ReadDeps = { db: Db; model: TextModel; caps?: Caps; now?: () => Date };

/** Reads one chapter: the stored answer if there is one for these entries and this style, else one paid call; then stores what it says. */
export async function readChapter(deps: ReadDeps, ownerId: string, bookId: string, chapter: Chapter, opts: { fresh?: boolean } = {}) {
  const known = await db_entries(deps.db, bookId);
  const passages = await chapterPassages(deps.db, bookId, chapter.chapterIndex);
  if (!passages.length) return { generation: null, reused: true, dropped: 0, entries: 0, facts: 0 };
  const req = await buildRequest(deps.db, ownerId, bookId, chapter, passages, known);
  const { generation, reused } = await generate(deps.db, deps.model, req, { fresh: opts.fresh, caps: deps.caps, now: deps.now });
  const checked = checkAnswer(generation.output, passages, known);
  const applied = await applyChapter(deps.db, bookId, generation.id, checked);
  return { generation, reused, dropped: checked.dropped, entries: applied.entries, facts: applied.facts };
}

async function db_entries(db: Db, bookId: string): Promise<XrayEntry[]> {
  return db.select({ id: xrayEntries.id, name: xrayEntries.name, kind: xrayEntries.kind, aliases: xrayEntries.aliases }).from(xrayEntries).where(eq(xrayEntries.bookId, bookId));
}

/** How many facts an answer offered that were not stored: what it said minus what passed the quote check. */
export async function droppedFor(db: Db, generationId: string, output: string) {
  let offered = 0;
  try {
    for (const e of (JSON.parse(output) as { entries?: { facts?: unknown[] }[] }).entries ?? []) offered += Array.isArray(e.facts) ? e.facts.length : 0;
  } catch {
    return 0;
  }
  const kept = await db.select({ id: xrayFacts.id }).from(xrayFacts).where(eq(xrayFacts.generationId, generationId));
  return Math.max(0, offered - kept.length);
}

// The whole-book read: one run per reader at a time, in this process (like whole-book narration), chapter by
// chapter, each call under the caps; a restart forgets a run but not its stored chapters.
export type XrayStop = { kind: "finished" | "stopped" | "limit" | "error"; message: string };
type Job = { ownerId: string; bookId: string; running: boolean; stopRequested: boolean; done: number; total: number; made: number; dropped: number; current: string | null; stoppedBecause: XrayStop | null; finished: Promise<void> };
const jobs = () => {
  const g = globalThis as typeof globalThis & { __xrayJobs?: Map<string, Job> };
  return (g.__xrayJobs ??= new Map());
};
const jobKey = (ownerId: string, bookId: string) => `${ownerId}|${bookId}`;

export type XraySummary = {
  chapters: number;
  done: number;
  estimateUsd: number;
  caps: { perBookUsd: number; perMonthUsd: number; spentBookUsd: number; spentMonthUsd: number };
  overLimit: boolean;
  running: boolean;
  stopping: boolean;
  stoppedBecause: XrayStop | null;
  current: string | null;
  dropped: number;
  facts: number;
};

/** What reading the whole book with Claude involves now: how much is done, what the rest would cost at most, and the caps. */
export async function xraySummary(db: Db, model: TextModel, ownerId: string, bookId: string, opts: { caps?: Caps; now?: () => Date } = {}): Promise<XraySummary> {
  const [book] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new XrayError("That book was not found.");
  const chapters = await bookChapters(db, bookId);
  const read = new Set(
    (await db.select({ sectionId: generations.sectionId }).from(generations).where(and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), eq(generations.kind, "xray")))).map((g) => g.sectionId),
  );
  let estimate = 0;
  for (const c of chapters) {
    if (read.has(c.id)) continue;
    const passages = await chapterPassages(db, bookId, c.chapterIndex);
    if (!passages.length) continue;
    estimate += estimateCost(model, await buildRequest(db, ownerId, bookId, c, passages, []));
  }
  const caps = opts.caps ?? capsFromEnv();
  const spent = await spendingWithJobs(db, model.provider, bookId, opts.now?.() ?? new Date());
  const job = jobs().get(jobKey(ownerId, bookId));
  const facts = await db.select({ id: xrayFacts.id }).from(xrayFacts).where(eq(xrayFacts.bookId, bookId));
  return {
    chapters: chapters.length,
    done: chapters.filter((c) => read.has(c.id)).length,
    estimateUsd: estimate,
    caps: { perBookUsd: caps.perBookUsd, perMonthUsd: caps.perMonthUsd, spentBookUsd: spent.book, spentMonthUsd: spent.month },
    overLimit: spent.month + estimate > caps.perMonthUsd || spent.book + estimate > caps.perBookUsd,
    running: job?.running ?? false,
    stopping: !!job?.running && job.stopRequested,
    stoppedBecause: job && !job.running ? job.stoppedBecause : null,
    current: job?.running ? job.current : null,
    dropped: job?.dropped ?? 0,
    facts: facts.length,
  };
}

/**
 * Starts reading the whole book, chapter by chapter, in the background, unless that is already going on. Refused
 * unless `confirm` is exactly true: the reader ticked "I understand this reads N chapters with Claude and costs
 * about $X at most". One run per reader at a time.
 */
export async function startXray(deps: ReadDeps, ownerId: string, bookId: string, confirm: unknown): Promise<{ started: boolean; finished: Promise<void> }> {
  const [book] = await deps.db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new XrayError("That book was not found.");
  if (confirm !== true) throw new XrayError("Nothing was started: first confirm that this reads the whole book with Claude, paid as it goes.");
  const key = jobKey(ownerId, bookId);
  const going = jobs().get(key);
  if (going?.running) return { started: false, finished: going.finished };
  const other = [...jobs().values()].find((j) => j.ownerId === ownerId && j.running);
  if (other) throw new XrayError("Another book is being read. Stop it first, or wait for it to finish.");
  const job: Job = { ownerId, bookId, running: true, stopRequested: false, done: 0, total: 0, made: 0, dropped: 0, current: null, stoppedBecause: null, finished: Promise.resolve() };
  jobs().set(key, job);
  job.finished = run(job, deps);
  return { started: true, finished: job.finished };
}

export function stopXray(ownerId: string, bookId: string) {
  const job = jobs().get(jobKey(ownerId, bookId));
  if (job?.running) job.stopRequested = true;
  return !!job?.running;
}

export function resetXrayJobsForTests() {
  jobs().clear();
}

async function run(job: Job, deps: ReadDeps) {
  const end = (kind: XrayStop["kind"], message: string) => {
    job.running = false;
    job.current = null;
    job.stoppedBecause = { kind, message };
  };
  try {
    const chapters = await bookChapters(deps.db, job.bookId);
    job.total = chapters.length;
    for (const c of chapters) {
      if (job.stopRequested) return end("stopped", "Stopped, as you asked.");
      job.current = c.label;
      const out = await readChapter(deps, job.ownerId, job.bookId, c);
      job.done += 1;
      job.dropped += out.dropped;
      if (out.generation && !out.reused) job.made += 1;
    }
    end("finished", job.dropped ? `Every chapter is read. ${job.dropped} ${job.dropped === 1 ? "fact was" : "facts were"} left out: their quotes were not in the book.` : "Every chapter is read.");
  } catch (e) {
    if (e instanceof SpendingCapReached) end("limit", e.message);
    else if (e instanceof AiError || e instanceof XrayError) end("error", e.message);
    else {
      console.error("Reading the book for X-ray stopped by an error:", e);
      end("error", "Something went wrong on the server.");
    }
  }
}
