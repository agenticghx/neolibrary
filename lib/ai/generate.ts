import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { isOwnKeyProvider } from "./own-key";
import type { Db } from "@/lib/db/client";
import { audioTracks, books, failedSpend, generations, textEditionJobs } from "@/lib/db/schema";
import { AiError, PRICES, costUsd, estimateTokens, type Effort, type TextModel, type TextResult } from "./model";
import { sha256 } from "./prompts";

/**
 * Pay for AI output once and record where it came from (ground rule 5), with
 * a hard spending cap (ground rule 8).
 *
 * - The same request (same kind, options, prompt fingerprint and input text,
 *   for the same reader) is answered from the `generations` table, without a
 *   second call. `fresh: true` asks again on purpose and adds a new version.
 * - Before any call, the most it can cost (holdCost) is reserved against what has been
 *   spent this month (all readers: one API key pays) and on this book. The
 *   reserve (a hold) is a row in the database, so a second call at the same
 *   moment, on any copy of the server, sees it, and a restart keeps it. If
 *   either cap would be passed, nothing is called. The hold is replaced by
 *   the real cost once it is written. The paid call itself is not inside the
 *   lock.
 */
export type Caps = { perBookUsd: number; perMonthUsd: number };

/** Caps from settings: AI_CAP_… for text AI, VOICE_CAP_… for voice, IMAGE_CAP_… for pictures. $5 per book and $20 per month unless set. */
export function capsFromEnv(env: Record<string, string | undefined> = process.env, prefix: "AI" | "VOICE" | "IMAGE" = "AI"): Caps {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return { perBookUsd: num(env[`${prefix}_CAP_PER_BOOK_USD`], 5), perMonthUsd: num(env[`${prefix}_CAP_PER_MONTH_USD`], 20) };
}

export class SpendingCapReached extends AiError {}

export type GenerationRequest = {
  ownerId: string;
  bookId: string | null;
  sectionId: string | null;
  kind: string;
  options: Record<string, string>;
  promptName: string;
  /** Fingerprint of the prompt file(s), from `sha256`. */
  promptHash: string;
  /** The text being worked on; its fingerprint is stored. */
  input: string;
  system: string;
  prompt: string;
  maxTokens: number;
  effort: Effort;
  schema?: Record<string, unknown>;
};

export type Generation = {
  id: string;
  kind: string;
  bookId: string | null;
  sectionId: string | null;
  options: Record<string, string>;
  output: string;
  provenance: {
    provider: string;
    model: string;
    promptName: string;
    promptHash: string;
    inputHash: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    createdAt: string;
  };
};

type Row = typeof generations.$inferSelect;

export const toGeneration = (r: Row): Generation => ({
  id: r.id,
  kind: r.kind,
  bookId: r.bookId,
  sectionId: r.sectionId,
  options: r.options,
  output: r.output,
  provenance: {
    provider: r.provider,
    model: r.model,
    promptName: r.promptName,
    promptHash: r.promptHash,
    inputHash: r.inputHash,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
    createdAt: r.createdAt.toISOString(),
  },
});

/** The key a stored answer is found by: its kind, options, prompt fingerprint and the fingerprint of its input. */
export const generationCacheKey = (kind: string, options: Record<string, string>, promptHash: string, inputHash: string) =>
  sha256(JSON.stringify([kind, Object.entries(options).sort(), promptHash, inputHash]));

const cacheKeyOf = (req: GenerationRequest) => generationCacheKey(req.kind, req.options, req.promptHash, sha256(req.input));

/**
 * The likely cost of a request, in US dollars: the price a reader is shown
 * ("about $X"). It assumes the prompt cache misses and the system prompt is
 * written to it (1.25 times the input price), and an answer of twice the
 * input plus 1,000 tokens. A call can cost more (all of maxTokens): what is
 * held against the cap while it runs is holdCost, not this.
 */
export function estimateCost(model: TextModel, req: Pick<GenerationRequest, "system" | "prompt" | "input" | "maxTokens">) {
  const output = Math.min(req.maxTokens, estimateTokens(req.input) * 2 + 1000);
  const system = estimateTokens(req.system);
  return costUsd(PRICES[model.model] ? model.model : "unknown", system + estimateTokens(req.prompt), output, { write: system, read: 0 });
}

/**
 * Tokens allowed, on top of the text, for what the API adds to a request: the
 * message framing, and the instructions it adds for a JSON schema. Not
 * measured (the API does not say); generous on purpose (M44, SKILL.md).
 */
export const HOLD_OVERHEAD_TOKENS = 2000;

/**
 * The most one call can be billed, in US dollars (M44, finding 1): what
 * reserveSpend holds against the caps while the call runs. Output: all of
 * maxTokens (thinking counts within it). Input: no more tokens than the
 * request's bytes (a token is at least one byte), plus HOLD_OVERHEAD_TOKENS,
 * all priced as written to the prompt cache (the dearest input price). Not
 * covered: a refusal rescued by the API's fallback model, billed on top
 * (SKILL.md, finding 1, what is left).
 */
export function holdCost(model: TextModel, req: Pick<GenerationRequest, "system" | "prompt" | "maxTokens" | "schema">) {
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  const input = bytes(req.system) + bytes(req.prompt) + (req.schema ? bytes(JSON.stringify(req.schema)) : 0) + HOLD_OVERHEAD_TOKENS;
  return costUsd(PRICES[model.model] ? model.model : "unknown", input, req.maxTokens, { write: input, read: 0 });
}

export const usd = (n: number) => `$${n < 1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * A book and its text edition (M25) share one per-book limit: the scan and
 * every edition made from it. For any other book, the book alone.
 */
export async function bookGroup(db: Db, bookId: string) {
  const [row] = await db.select({ editionOf: books.editionOf }).from(books).where(eq(books.id, bookId));
  const scanId = row?.editionOf ?? bookId;
  const editions = await db.select({ id: books.id }).from(books).where(eq(books.editionOf, scanId));
  return [scanId, ...editions.map((e) => e.id)];
}

/**
 * Holds (M44): while a paid call runs, the most it can cost (holdCost, for `generate`) is a row in `failed_spend` of this kind, so every
 * copy of the server sees it, and a restart does not lose it. It is replaced by the real cost when the
 * call ends (the `generations` row, or a `failed_spend` row of the call's own kind), or deleted when
 * nothing was billed. A hold that stays means the server stopped, or the database failed, mid-call:
 * the provider may have billed it, so it stays counted in full (the costs page shows it).
 */
export const HOLD_KIND = "spend-hold";
const HOLD_REASON =
  "Held while a paid call runs: the most it can cost counts until its real cost is written. If this row stays, the server stopped or the database failed mid-call; the call may have been billed, so this amount stays counted.";

/**
 * Dollars spent with a provider (text and audio) since the start of this month (UTC), and on one book ever
 * (a scan and its text edition counted together). Holds of calls still running are not spending: see heldByCalls.
 * Rows brought back from a library file are left out: that money was not spent here.
 */
export async function spending(db: Db, provider: string, bookId: string | null, now = new Date()) {
  const group = bookId ? await bookGroup(db, bookId) : [];
  const sum = async (table: typeof generations | typeof audioTracks, book: boolean) => {
    const r = await db
      .select({ usd: sql<number>`coalesce(sum(${table.costUsd}), 0)::float8` })
      .from(table)
      .where(
        and(
          eq(table.provider, provider),
          eq(table.imported, false),
          book && bookId ? inArray(table.bookId, group) : gte(table.createdAt, monthStart(now)),
        ),
      );
    return Number(r[0]?.usd ?? 0);
  };
  // Calls that were billed but gave nothing usable (failed_spend) count too; holds are counted apart.
  const failed = async (book: boolean, holds: boolean) => {
    const r = await db
      .select({ usd: sql<number>`coalesce(sum(${failedSpend.costUsd}), 0)::float8` })
      .from(failedSpend)
      .where(
        and(
          eq(failedSpend.provider, provider),
          holds ? eq(failedSpend.kind, HOLD_KIND) : ne(failedSpend.kind, HOLD_KIND),
          book && bookId ? inArray(failedSpend.bookId, group) : gte(failedSpend.createdAt, monthStart(now)),
        ),
      );
    return Number(r[0]?.usd ?? 0);
  };
  const month = (await sum(generations, false)) + (await sum(audioTracks, false)) + (await failed(false, false));
  const book = bookId ? (await sum(generations, true)) + (await sum(audioTracks, true)) + (await failed(true, false)) : 0;
  return { month, book };
}

type Spent = { month: number; book: number };

/** What the holds of paid calls still running (or left by a restart) hold: this month's, and this book group's ever. */
export async function heldByCalls(db: Db, provider: string, bookId: string | null, now = new Date()): Promise<Spent> {
  const sum = async (where: ReturnType<typeof and>) => {
    const [r] = await db
      .select({ usd: sql<number>`coalesce(sum(${failedSpend.costUsd}), 0)::float8` })
      .from(failedSpend)
      .where(and(eq(failedSpend.provider, provider), eq(failedSpend.kind, HOLD_KIND), where));
    return Number(r?.usd ?? 0);
  };
  const month = await sum(gte(failedSpend.createdAt, monthStart(now)));
  const book = bookId ? await sum(inArray(failedSpend.bookId, await bookGroup(db, bookId))) : 0;
  return { month, book };
}

/**
 * What text-edition jobs going on (M25) still hold against the caps: each
 * job's estimate, less what its pages have cost so far. A batch is paid for
 * as Anthropic answers it, hours later; the hold keeps other requests from
 * spending the same money meanwhile. It goes when the job ends.
 */
export async function heldByJobs(db: Db, provider: string, bookId: string | null): Promise<Spent> {
  const group = bookId ? await bookGroup(db, bookId) : [];
  const jobs = await db
    .select({ bookId: textEditionJobs.bookId, estimate: textEditionJobs.estimateUsd, createdAt: textEditionJobs.createdAt })
    .from(textEditionJobs)
    .where(and(eq(textEditionJobs.provider, provider), inArray(textEditionJobs.status, ["preparing", "waiting"])));
  const held = { month: 0, book: 0 };
  for (const job of jobs) {
    const [r] = await db
      .select({ usd: sql<number>`coalesce(sum(${generations.costUsd}), 0)::float8` })
      .from(generations)
      .where(and(eq(generations.bookId, job.bookId), eq(generations.provider, provider), gte(generations.createdAt, job.createdAt), sql`${generations.kind} like 'transcribe%'`));
    const left = Math.max(0, job.estimate - Number(r?.usd ?? 0));
    held.month += left;
    if (group.includes(job.bookId)) held.book += left;
  }
  return held;
}

/** What text-edition jobs and paid calls going on hold together. */
export async function heldNow(db: Db, provider: string, bookId: string | null, now = new Date()): Promise<Spent> {
  const jobs = await heldByJobs(db, provider, bookId);
  const calls = await heldByCalls(db, provider, bookId, now);
  return { month: jobs.month + calls.month, book: jobs.book + calls.book };
}

/** What has been spent, plus what jobs and calls going on still hold: what a new request must fit beside. */
export async function spendingWithJobs(db: Db, provider: string, bookId: string | null, now = new Date()): Promise<Spent> {
  const spent = await spending(db, provider, bookId, now);
  const held = await heldNow(db, provider, bookId, now);
  return { month: spent.month + held.month, book: spent.book + held.book };
}

function capEnv(label: string) {
  return label === "AI" ? "AI" : label === "image" ? "IMAGE" : "VOICE";
}

/** Throws if `estimate` more, on top of what is spent and held, would pass a cap. */
export function assertRoom(spent: Spent, held: Spent, estimate: number, caps: Caps, label: string, bookId: string | null) {
  const env = capEnv(label);
  if (spent.month + held.month + estimate > caps.perMonthUsd) {
    throw new SpendingCapReached(
      `This month's ${label} spending cap (${usd(caps.perMonthUsd)}) has been reached (${usd(spent.month)} spent). It resets on the 1st, or the owner can raise ${env}_CAP_PER_MONTH_USD.`,
    );
  }
  if (bookId && spent.book + held.book + estimate > caps.perBookUsd) {
    throw new SpendingCapReached(
      `This book's ${label} spending cap (${usd(caps.perBookUsd)}) has been reached (${usd(spent.book)} spent). The owner can raise ${env}_CAP_PER_BOOK_USD.`,
    );
  }
}

// The spending lock: a Postgres advisory lock per provider, taken inside a transaction (it goes when the
// transaction ends, or its connection does), so every copy of the server takes turns. In front of it, each
// process queues its own turns (spendTails), so at most one of its connections waits for the lock: the
// production pool has five. The lock covers the check and the hold, and the hold's settling, not the paid call.
const SPEND_LOCK = 1_313_166_675; // the advisory lock's first key: this app's spending lock
const spendTails = new Map<string, Promise<void>>();

function lockSpend<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const prev = spendTails.get(provider) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  spendTails.set(provider, run.then(() => {}, () => {}));
  return run;
}

/**
 * Runs `fn` in a transaction that holds the provider's spending lock. Every query inside must use `tx`, never
 * the outer `db`: on PGlite (one connection) the outer one waits for the transaction, and in production it takes
 * a second connection from the pool.
 */
export function withSpendLock<T>(db: Db, provider: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return lockSpend(provider, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${SPEND_LOCK}::int4, hashtext(${provider}))`);
      return fn(tx as unknown as Db);
    }),
  );
}

/** Forgets this process's queue for the spending lock, as a restart would. Holds are rows: each test database has its own. Tests only. */
export function resetSpendHoldsForTests() {
  spendTails.clear();
}

/** Who and what a hold is for: written on its row, so the costs page and a later look can tell. */
export type HoldFor = { ownerId: string; bookId: string | null; model: string; kind: string };

/** A paid call's real cost, when it was billed but its result is not kept. */
export type BilledCost = { model: string; inputTokens?: number; outputTokens?: number; costUsd: number; reason: string };

/**
 * A call's hold. Settle it once, after the call: `release()` once its cost is written elsewhere (its
 * `generations` or `audio_tracks` row) or when nothing was billed; `billed()` when the provider billed it
 * but nothing is kept, so the hold becomes a `failed_spend` row of the real cost. Either is a no-op after
 * the first. If the database fails meanwhile, the hold stays, counted at its estimate.
 */
export type SpendHold = { release(): Promise<void>; billed(cost: BilledCost): Promise<void> };

const NO_HOLD: SpendHold = { release: () => Promise.resolve(), billed: () => Promise.resolve() };

/**
 * Reserves `estimate` against the caps, or throws when it would pass one. Two callers at the same moment,
 * on any copy of the server, cannot both pass a check that only one of them fits.
 */
export async function reserveSpend(
  db: Db,
  provider: string,
  holdFor: HoldFor,
  estimate: number,
  caps: Caps,
  now: Date,
  label: string,
): Promise<SpendHold> {
  // M34 S4: a call on the asker's own key spends nothing of the owner's, so no cap of the owner's applies to it.
  if (isOwnKeyProvider(provider)) return NO_HOLD;
  const { bookId } = holdFor;
  const id = await withSpendLock(db, provider, async (tx) => {
    const spent = await spending(tx, provider, bookId, now);
    const held = await heldNow(tx, provider, bookId, now);
    assertRoom(spent, held, estimate, caps, label, bookId);
    const [row] = await tx
      .insert(failedSpend)
      .values({ ownerId: holdFor.ownerId, bookId, provider, model: holdFor.model, kind: HOLD_KIND, costUsd: estimate, reason: `${HOLD_REASON} For: ${holdFor.kind}.`, createdAt: now })
      .returning({ id: failedSpend.id });
    return row.id;
  });
  let settled = false;
  const settle = async (change: (tx: Db) => Promise<unknown>) => {
    if (settled) return;
    settled = true;
    await withSpendLock(db, provider, change);
  };
  return {
    release: () => settle((tx) => tx.delete(failedSpend).where(eq(failedSpend.id, id))),
    billed: (cost) =>
      settle((tx) =>
        tx
          .update(failedSpend)
          .set({
            model: cost.model,
            kind: holdFor.kind,
            inputTokens: cost.inputTokens ?? 0,
            outputTokens: cost.outputTokens ?? 0,
            costUsd: cost.costUsd,
            reason: cost.reason.slice(0, 300),
          })
          .where(eq(failedSpend.id, id)),
      ),
  };
}

export async function findStored(db: Db, ownerId: string, req: GenerationRequest) {
  const [row] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.ownerId, ownerId), eq(generations.cacheKey, cacheKeyOf(req))))
    .orderBy(desc(generations.createdAt))
    .limit(1);
  return row ? toGeneration(row) : null;
}

/**
 * Kinds whose answer depends only on the book's text and the options, never
 * on what the reader wrote or asked (2026-10-17, Samuel: "share saved results
 * between readers of the same book"). Ask and Explain it back carry the
 * reader's own words, so they stay with that reader.
 */
export const SHARED_KINDS = ["rewrite", "prerequisites", "questions", "xray", "xray-world"];

/**
 * Another reader's stored answer to exactly this request, copied into this
 * reader's own list at no cost. The key includes a fingerprint of the input
 * text, so a reader only ever receives an answer made from text their own
 * copy of the book holds: nothing crosses from a book they do not have
 * (ground rule 6). The copy keeps the original's model, prompt and input
 * fingerprints (ground rule 5); its tokens and cost are 0, since nothing was
 * paid for it.
 */
export async function copyShared(db: Db, req: GenerationRequest, now: Date) {
  if (!SHARED_KINDS.includes(req.kind)) return null;
  const [found] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.cacheKey, cacheKeyOf(req)), eq(generations.kind, req.kind)))
    .orderBy(desc(generations.createdAt))
    .limit(1);
  if (!found) return null;
  const [row] = await db
    .insert(generations)
    .values({
      ownerId: req.ownerId,
      bookId: req.bookId,
      sectionId: req.sectionId,
      kind: req.kind,
      options: req.options,
      cacheKey: found.cacheKey,
      provider: found.provider,
      model: found.model,
      promptName: found.promptName,
      promptHash: found.promptHash,
      inputHash: found.inputHash,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      output: found.output,
      createdAt: now,
    })
    .returning();
  return toGeneration(row);
}

/** A hold that could not be settled stays counted at its estimate: say so in the log, and go on. */
export const keptHold = (e: unknown) => console.error("Spending: a hold could not be settled and stays counted at its estimate:", e instanceof Error ? e.message : e);

// Two identical requests at the same moment share one call.
const inflight = new Map<string, Promise<Generation>>();

export async function generate(
  db: Db,
  model: TextModel,
  req: GenerationRequest,
  opts: { fresh?: boolean; caps?: Caps; now?: () => Date } = {},
): Promise<{ generation: Generation; reused: boolean }> {
  if (!opts.fresh) {
    const stored = await findStored(db, req.ownerId, req);
    if (stored) return { generation: stored, reused: true };
    const shared = await copyShared(db, req, opts.now?.() ?? new Date());
    if (shared) return { generation: shared, reused: true };
  }
  const key = `${req.ownerId}|${cacheKeyOf(req)}|${opts.fresh ? Math.random() : ""}`;
  const running = inflight.get(key);
  if (running) return { generation: await running, reused: true };
  const job = (async () => {
    const caps = opts.caps ?? capsFromEnv();
    const now = opts.now?.() ?? new Date();
    const hold = await reserveSpend(
      db,
      model.provider,
      { ownerId: req.ownerId, bookId: req.bookId, model: model.model, kind: req.kind },
      holdCost(model, req),
      caps,
      now,
      "AI",
    );
    let result: TextResult;
    try {
      result = await model.generate({
        system: req.system,
        prompt: req.prompt,
        maxTokens: req.maxTokens,
        effort: req.effort,
        ...(req.schema ? { schema: req.schema } : {}),
      });
    } catch (e) {
      // Billed but unusable: the hold becomes the real cost (one UPDATE), so the next call's cap check sees it.
      if (e instanceof AiError && e.billed) {
        await hold
          .billed({
            model: e.billed.model,
            inputTokens: e.billed.inputTokens,
            outputTokens: e.billed.outputTokens,
            costUsd: costUsd(e.billed.model, e.billed.inputTokens, e.billed.outputTokens, e.billed.cache),
            reason: e.message,
          })
          .catch(keptHold);
      } else await hold.release().catch(keptHold);
      throw e;
    }
    const cost = costUsd(result.model, result.inputTokens, result.outputTokens, result.cache);
    let row: Row;
    try {
      [row] = await db
        .insert(generations)
        .values({
          ownerId: req.ownerId,
          bookId: req.bookId,
          sectionId: req.sectionId,
          kind: req.kind,
          options: req.options,
          cacheKey: cacheKeyOf(req),
          provider: model.provider,
          model: result.model,
          promptName: req.promptName,
          promptHash: req.promptHash,
          inputHash: sha256(req.input),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: cost,
          output: result.text,
          createdAt: now,
        })
        .returning();
    } catch (e) {
      // Paid, but the answer could not be saved: its cost is still counted, as a billed failure.
      await hold
        .billed({
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: cost,
          reason: `Paid, but the answer could not be saved: ${e instanceof Error ? e.message : String(e)}`,
        })
        .catch(keptHold);
      throw e;
    }
    // The answer and its cost are saved: the hold goes. Should that fail, the hold stays counted beside the cost (too much, never too little).
    await hold.release().catch(keptHold);
    return toGeneration(row);
  })();
  inflight.set(key, job);
  try {
    return { generation: await job, reused: false };
  } finally {
    inflight.delete(key);
  }
}

/** Every stored answer of one kind for one section, oldest first (the versions to flip between). */
/** listGenerations for several paragraphs in one query: each paragraph's, oldest first (absent: none). */
export async function listGenerationsFor(db: Db, ownerId: string, bookId: string, sectionIds: string[], kind: string) {
  const out = new Map<string, Generation[]>();
  if (!sectionIds.length) return out;
  const rows = await db
    .select()
    .from(generations)
    .where(
      and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), inArray(generations.sectionId, sectionIds), eq(generations.kind, kind)),
    )
    .orderBy(asc(generations.createdAt), asc(generations.id));
  for (const r of rows) out.set(r.sectionId!, [...(out.get(r.sectionId!) ?? []), toGeneration(r)]);
  return out;
}

export async function listGenerations(db: Db, ownerId: string, bookId: string, sectionId: string, kind: string) {
  const rows = await db
    .select()
    .from(generations)
    .where(
      and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), eq(generations.sectionId, sectionId), eq(generations.kind, kind)),
    )
    .orderBy(asc(generations.createdAt), asc(generations.id));
  return rows.map(toGeneration);
}
