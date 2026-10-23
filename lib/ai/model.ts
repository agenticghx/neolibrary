/**
 * The text-AI interface (M6, ground rule 3). The app only talks to this
 * interface: `ClaudeModel` calls the real Claude API, `FakeModel` gives
 * predictable answers for tests and costs nothing.
 */
export type Effort = "low" | "medium" | "high";

export type TextRequest = {
  system: string;
  prompt: string;
  /** Upper limit on output, thinking included. */
  maxTokens: number;
  effort: Effort;
  /** Ask for JSON matching this JSON Schema (structured output) instead of prose. */
  schema?: Record<string, unknown>;
};

export type TextResult = {
  text: string;
  /** The model that actually wrote the text (a fallback model can step in). */
  model: string;
  /** All input tokens, cached or not. */
  inputTokens: number;
  outputTokens: number;
  /** How many of the input tokens were written to Anthropic's prompt cache, and how many were read from it. */
  cache?: CacheTokens;
};

export type CacheTokens = { write: number; read: number };

export interface TextModel {
  /** The provider, for spending caps ("anthropic"). */
  readonly provider: string;
  /** The model asked for. */
  readonly model: string;
  generate(req: TextRequest): Promise<TextResult>;
}

export class AiError extends Error {}
/** No API key is set, so real calls are impossible. */
export class AiNotConfigured extends AiError {}
/** The model declined to answer. */
export class AiRefused extends AiError {}

/**
 * US dollars per million tokens, from Anthropic's price list (checked
 * 2026-10-17). Prompt caching: the long fixed instructions (the system
 * prompt) are written to Anthropic's cache once (`cacheWrite`, 1.25 times
 * the input price, kept 5 minutes) and then read back (`cacheRead`): a
 * twentieth of the input price on Opus 5.5 and Sonnet 5.5, a tenth on the
 * others.
 */
export const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  // Up to 100,000 tokens of prompt; a longer prompt is priced five times higher (below).
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  fake: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};
// A model missing from the list is charged at the highest price we know, so
// the spending cap errs on the safe side.
const UNKNOWN = { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 };
const HAIKU_LONG = { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 };

/**
 * The cost of a call. `inputTokens` counts all input; `cache` says how much
 * of it was written to or read from the prompt cache, priced at those rates
 * (the rest at the full input price). Haiku's prompt length counts cached
 * tokens too, as Anthropic counts it.
 */
export function costUsd(model: string, inputTokens: number, outputTokens: number, cache: CacheTokens = { write: 0, read: 0 }) {
  const p = model === "claude-haiku-5-5" && inputTokens > 100_000 ? HAIKU_LONG : (PRICES[model] ?? UNKNOWN);
  const uncached = Math.max(0, inputTokens - cache.write - cache.read);
  return (uncached * p.input + cache.write * p.cacheWrite + cache.read * p.cacheRead + outputTokens * p.output) / 1_000_000;
}

/**
 * The AI features, each with its own model (2026-10-17, Samuel: "Haiku for
 * routine jobs"). Chosen from a side-by-side run on five of Samuel's books
 * (scripts/compare-models.ts): Need to know and Test yourself go to Claude
 * Haiku 5.5, about 30 times cheaper than Opus and as accurate there. Rewrites
 * stand in for the book's text, and Haiku once dropped a quarter of a
 * paragraph, so they go to Sonnet 5.5 (half Opus's price; Opus follows strict
 * STE a little more closely). Judging what a reader wrote or asked stays on
 * Opus. Each can be changed on the server with AI_MODEL_<FEATURE>, e.g.
 * AI_MODEL_REWRITE=claude-opus-5-5.
 */
export const FEATURE_MODELS = {
  rewrite: "claude-sonnet-5-5",
  prerequisites: "claude-haiku-5-5",
  questions: "claude-haiku-5-5",
  ask: "claude-opus-5-5",
  "explain-back": "claude-opus-5-5",
  // M32 X3: reading a chapter for who and what it names is routine indexing, Haiku's kind of job.
  xray: "claude-haiku-5-5",
  // M32 X4: a few sentences of general knowledge about a name: routine too.
  "xray-world": "claude-haiku-5-5",
} as const;
export type AiFeature = keyof typeof FEATURE_MODELS;

/** The model for a feature: its AI_MODEL_<FEATURE> setting if it names a model we have a price for, else the default above. */
export function modelFor(feature: AiFeature, env: Record<string, string | undefined> = process.env): string {
  const set = env[`AI_MODEL_${feature.toUpperCase().replace(/-/g, "_")}`]?.trim();
  return set && set !== "fake" && PRICES[set] ? set : FEATURE_MODELS[feature];
}

/** A rough token count: about four characters per token for English. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
