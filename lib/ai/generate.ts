import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { audioTracks, generations } from "@/lib/db/schema";
import { AiError, PRICES, costUsd, estimateTokens, type Effort, type TextModel } from "./model";
import { sha256 } from "./prompts";

/**
 * Pay for AI output once and record where it came from (ground rule 5), with
 * a hard spending cap (ground rule 8).
 *
 * - The same request (same kind, options, prompt fingerprint and input text,
 *   for the same reader) is answered from the `generations` table, without a
 *   second call. `fresh: true` asks again on purpose and adds a new version.
 * - Before any call, the estimated cost is reserved against what has been
 *   spent this month (all readers: one API key pays) and on this book. A
 *   second call at the same moment sees that reserve. If either cap would
 *   be passed, nothing is called. The reserve is released once the cost is
 *   recorded. The paid call itself is not inside the lock.
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

const cacheKeyOf = (req: GenerationRequest) =>
  sha256(JSON.stringify([req.kind, Object.entries(req.options).sort(), req.promptHash, sha256(req.input)]));

/** The estimated cost of a request, in US dollars: generous, so the cap errs on the safe side. */
export function estimateCost(model: TextModel, req: Pick<GenerationRequest, "system" | "prompt" | "input" | "maxTokens">) {
  const output = Math.min(req.maxTokens, estimateTokens(req.input) * 2 + 1000);
  return costUsd(PRICES[model.model] ? model.model : "unknown", estimateTokens(req.system + req.prompt), output);
}

export const usd = (n: number) => `$${n < 1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Dollars spent with a provider (text and audio) since the start of this month (UTC), and on one book ever.
 * Rows brought back from a library file are left out: that money was not spent here.
 */
export async function spending(db: Db, provider: string, bookId: string | null, now = new Date()) {
  const sum = async (table: typeof generations | typeof audioTracks, book: boolean) => {
    const r = await db
      .select({ usd: sql<number>`coalesce(sum(${table.costUsd}), 0)::float8` })
      .from(table)
      .where(
        and(
          eq(table.provider, provider),
          eq(table.imported, false),
          book && bookId ? eq(table.bookId, bookId) : gte(table.createdAt, monthStart(now)),
        ),
      );
    return Number(r[0]?.usd ?? 0);
  };
  const month = (await sum(generations, false)) + (await sum(audioTracks, false));
  const book = bookId ? (await sum(generations, true)) + (await sum(audioTracks, true)) : 0;
  return { month, book };
}

type Spent = { month: number; book: number };
type ReadSpend = (db: Db, provider: string, bookId: string | null, now: Date) => Promise<Spent>;

function capEnv(label: string) {
  return label === "AI" ? "AI" : label === "image" ? "IMAGE" : "VOICE";
}

/** Throws if `estimate` more, on top of what is already reserved, would pass a cap. */
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

/** Throws if spending `estimate` more would pass a cap. */
export async function checkCaps(db: Db, provider: string, bookId: string | null, estimate: number, caps: Caps, now: Date, label: string) {
  assertRoom(await spending(db, provider, bookId, now), { month: 0, book: 0 }, estimate, caps, label, bookId);
}

// Reserves live in this process. The lock only covers the check and the
// reserve, not the paid call, so one Listen does not wait for another's
// network call. A second copy of the server would not see them.
const spendTails = new Map<string, Promise<void>>();
const spendHolds = new Map<string, number>();

const monthKey = (provider: string) => `${provider}\0month`;
const bookKey = (provider: string, bookId: string) => `${provider}\0book\0${bookId}`;

function holdOf(key: string) {
  return spendHolds.get(key) ?? 0;
}

function addHold(key: string, estimate: number) {
  const next = holdOf(key) + estimate;
  if (Math.abs(next) < 1e-9) spendHolds.delete(key);
  else spendHolds.set(key, next);
}

function lockSpend<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const prev = spendTails.get(provider) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  spendTails.set(provider, run.then(() => {}, () => {}));
  return run;
}

/** Clears the in-process reserves. Tests only. */
export function resetSpendHoldsForTests() {
  spendTails.clear();
  spendHolds.clear();
}

/**
 * Reserves `estimate` against the caps, or throws when it would pass one.
 * Call the returned function after the cost is recorded (or the call failed)
 * so the reserve is not counted twice. Two callers at the same moment cannot
 * both pass a check that only one of them fits.
 */
export async function reserveSpend(
  db: Db,
  provider: string,
  bookId: string | null,
  estimate: number,
  caps: Caps,
  now: Date,
  label: string,
  read: ReadSpend = spending,
): Promise<() => Promise<void>> {
  await lockSpend(provider, async () => {
    const spent = await read(db, provider, bookId, now);
    const held = { month: holdOf(monthKey(provider)), book: bookId ? holdOf(bookKey(provider, bookId)) : 0 };
    assertRoom(spent, held, estimate, caps, label, bookId);
    addHold(monthKey(provider), estimate);
    if (bookId) addHold(bookKey(provider, bookId), estimate);
  });
  let released = false;
  return () => {
    if (released) return Promise.resolve();
    released = true;
    return lockSpend(provider, async () => {
      addHold(monthKey(provider), -estimate);
      if (bookId) addHold(bookKey(provider, bookId), -estimate);
    });
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
  }
  const key = `${req.ownerId}|${cacheKeyOf(req)}|${opts.fresh ? Math.random() : ""}`;
  const running = inflight.get(key);
  if (running) return { generation: await running, reused: true };
  const job = (async () => {
    const caps = opts.caps ?? capsFromEnv();
    const now = opts.now?.() ?? new Date();
    const release = await reserveSpend(db, model.provider, req.bookId, estimateCost(model, req), caps, now, "AI");
    try {
      const result = await model.generate({
        system: req.system,
        prompt: req.prompt,
        maxTokens: req.maxTokens,
        effort: req.effort,
        ...(req.schema ? { schema: req.schema } : {}),
      });
      const [row] = await db
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
          costUsd: costUsd(result.model, result.inputTokens, result.outputTokens),
          output: result.text,
          createdAt: now,
        })
        .returning();
      return toGeneration(row);
    } finally {
      await release();
    }
  })();
  inflight.set(key, job);
  try {
    return { generation: await job, reused: false };
  } finally {
    inflight.delete(key);
  }
}

/** Every stored answer of one kind for one section, oldest first (the versions to flip between). */
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
