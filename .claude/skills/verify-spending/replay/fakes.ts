// Shared by the replays: a fake AI provider whose calls wait until the test answers them, and a
// database wrapper that delivers one read late. No network, no key, no money.
import type { Db } from "@/lib/db/client";
import type { GenerationRequest } from "@/lib/ai/generate";
import { AiError, costUsd, estimateTokens, type TextModel, type TextRequest, type TextResult } from "@/lib/ai/model";

export const MODEL = "claude-sonnet-5-5"; // the rewrite model (FEATURE_MODELS.rewrite)

type Waiting = { req: TextRequest; answer: (over?: Partial<TextResult>) => void; fail: (e: unknown) => void };

/**
 * A provider that charges the moment it answers, as a real one does. `charged` is what it has
 * billed, whatever the app wrote down; `charge` bills for a call whose answer never reached the app.
 */
export function fakeProvider(model = MODEL) {
  const charged: number[] = [];
  const waiting: Waiting[] = [];
  const text: TextModel = {
    provider: "anthropic",
    model,
    generate: (req) =>
      new Promise<TextResult>((resolve, reject) => {
        waiting.push({
          req,
          answer: (over = {}) => {
            const out: TextResult = { text: "A rewrite.", model, inputTokens: 200, outputTokens: 100, cache: { write: 0, read: 0 }, ...over };
            charged.push(costUsd(out.model, out.inputTokens, out.outputTokens, out.cache));
            resolve(out);
          },
          fail: reject,
        });
      }),
  };
  return {
    model: text,
    charged,
    waiting,
    total: () => charged.reduce((a, b) => a + b, 0),
    charge: (usd: number) => charged.push(usd),
    /** Answers with exactly the tokens estimateCost assumed, so the call costs its estimate. */
    atEstimate: (req: Pick<GenerationRequest, "system" | "prompt" | "input" | "maxTokens">): Partial<TextResult> => {
      const system = estimateTokens(req.system);
      return {
        inputTokens: system + estimateTokens(req.prompt),
        outputTokens: Math.min(req.maxTokens, estimateTokens(req.input) * 2 + 1000),
        cache: { write: system, read: 0 },
      };
    },
    billedFailure: () => Object.assign(new AiError("The answer was cut off before it finished."), { billed: { model, inputTokens: 200, outputTokens: 100, cache: { write: 0, read: 0 } } }),
  };
}

/** Waits (a few event-loop turns at a time) until `ready()` is true. */
export async function until(ready: () => boolean, what = "the condition") {
  for (let i = 0; i < 2000; i++) {
    if (ready()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** A request like a rewrite of one paragraph (400 characters). */
export function rewriteRequest(ownerId: string, over: Partial<GenerationRequest> = {}): GenerationRequest {
  const input = "The paragraph to rewrite. ".repeat(16).slice(0, 400);
  return {
    ownerId,
    bookId: null,
    sectionId: null,
    kind: "rewrite",
    options: { level: "plain" },
    promptName: "rewrite",
    promptHash: "replay",
    input,
    system: "Rewrite the paragraph in plain English. ".repeat(10).slice(0, 400),
    prompt: input,
    maxTokens: 4000,
    effort: "low",
    ...over,
  };
}

type Then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise<unknown>;

/** A query builder whose result, when awaited, first goes through `wrap` (every method keeps the wrapping). */
function wrapped(builder: unknown, wrap: (run: Then) => Then): unknown {
  if (typeof builder !== "object" || builder === null) return builder;
  return new Proxy(builder, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key === "then") return wrap((value as Then).bind(target));
      return typeof value === "function" ? (...args: unknown[]) => wrapped(value.apply(target, args), wrap) : value;
    },
  });
}

function withMethod(db: Db, name: "select" | "insert", replace: (original: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown): Db {
  return new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key === name) return replace((value as (...a: unknown[]) => unknown).bind(target));
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Db;
}

/**
 * The database as one request sees it, when its first SELECT runs at once but its answer arrives
 * only after `gate` opens (a slow connection in the pool). Everything else goes straight through.
 */
export function firstReadArrivesLate(db: Db, gate: Promise<void>): Db {
  let used = false;
  return withMethod(db, "select", (select) => (...args) => {
    const builder = select(...args);
    if (used) return builder;
    used = true;
    return wrapped(builder, (run) => (ok, bad) => run((v) => gate.then(() => v), (e) => gate.then(() => Promise.reject(e))).then(ok, bad));
  });
}

/** The database, with `hook` run just before an insert into `table` is sent; a hook that throws makes the insert fail. */
export function onInsert(db: Db, table: object, hook: () => Promise<void> | void): Db {
  return withMethod(db, "insert", (insert) => (t, ...rest) => {
    const builder = insert(t, ...rest);
    if (t !== table) return builder;
    return wrapped(builder, (run) => (ok, bad) => Promise.resolve().then(hook).then(() => run(ok, bad), bad));
  });
}
