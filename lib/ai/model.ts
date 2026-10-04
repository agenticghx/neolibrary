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
  inputTokens: number;
  outputTokens: number;
};

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

/** US dollars per million tokens, from Anthropic's price list (checked 2026-10-04). */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  fake: { input: 4, output: 20 },
};
// A model missing from the list is charged at the highest price we know, so
// the spending cap errs on the safe side.
const UNKNOWN = { input: 10, output: 50 };

export function costUsd(model: string, inputTokens: number, outputTokens: number) {
  const p = PRICES[model] ?? UNKNOWN;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** A rough token count: about four characters per token for English. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
