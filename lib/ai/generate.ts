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
 * - Before any call, the estimated cost is added to what has been spent this
 *   month (all readers: one API key pays) and on this book; if either would
 *   pass its cap, nothing is called.
 */
export type Caps = { perBookUsd: number; perMonthUsd: number };

/** Caps from settings: AI_CAP_… for text AI, VOICE_CAP_… for reading aloud. $5 per book and $20 per month unless set. */
export function capsFromEnv(env: Record<string, string | undefined> = process.env, prefix: "AI" | "VOICE" = "AI"): Caps {
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

/** Dollars spent with a provider (text and audio) since the start of this month (UTC), and on one book ever. */
export async function spending(db: Db, provider: string, bookId: string | null, now = new Date()) {
  const sum = async (table: typeof generations | typeof audioTracks, book: boolean) => {
    const r = await db
      .select({ usd: sql<number>`coalesce(sum(${table.costUsd}), 0)::float8` })
      .from(table)
      .where(
        and(eq(table.provider, provider), book && bookId ? eq(table.bookId, bookId) : gte(table.createdAt, monthStart(now))),
      );
    return Number(r[0]?.usd ?? 0);
  };
  const month = (await sum(generations, false)) + (await sum(audioTracks, false));
  const book = bookId ? (await sum(generations, true)) + (await sum(audioTracks, true)) : 0;
  return { month, book };
}

/** Throws if spending `estimate` more would pass a cap. */
export async function checkCaps(db: Db, provider: string, bookId: string | null, estimate: number, caps: Caps, now: Date, label: string) {
  const spent = await spending(db, provider, bookId, now);
  const env = label === "AI" ? "AI" : "VOICE";
  if (spent.month + estimate > caps.perMonthUsd) {
    throw new SpendingCapReached(
      `This month's ${label} spending cap (${usd(caps.perMonthUsd)}) has been reached (${usd(spent.month)} spent). It resets on the 1st, or the owner can raise ${env}_CAP_PER_MONTH_USD.`,
    );
  }
  if (bookId && spent.book + estimate > caps.perBookUsd) {
    throw new SpendingCapReached(
      `This book's ${label} spending cap (${usd(caps.perBookUsd)}) has been reached (${usd(spent.book)} spent). The owner can raise ${env}_CAP_PER_BOOK_USD.`,
    );
  }
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
    await checkCaps(db, model.provider, req.bookId, estimateCost(model, req), caps, now, "AI");
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
