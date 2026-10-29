import { FakeBatchModel, type TextBatchModel } from "./batch";
import { ClaudeModel } from "./claude";
import { ClaudeBatchModel } from "./claude-batch";
import { FakeModel } from "./fake";
import { AiNotConfigured, modelFor, type AiFeature, type ModelPicks, type TextModel } from "./model";

/**
 * The model the app uses. Tests (and the browser tests, via AI_FAKE=1) get
 * the fake; otherwise a real key is required. With no key the app says so
 * instead of inventing output.
 */
const g = globalThis as unknown as { __neolibraryFakeModel?: FakeModel; __neolibraryFakeBatchModel?: FakeBatchModel };

export function aiIsFake(env: Record<string, string | undefined> = process.env) {
  return env.AI_FAKE === "1" || Boolean(env.VITEST);
}

/** The model for one AI feature (see FEATURE_MODELS): Haiku for routine work, Opus where it judges what a reader wrote. */
export function getTextModel(feature: AiFeature, env: Record<string, string | undefined> = process.env, picks: ModelPicks = {}): TextModel {
  if (aiIsFake(env)) return (g.__neolibraryFakeModel ??= new FakeModel());
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new AiNotConfigured("AI is not set up yet: the owner needs to add ANTHROPIC_API_KEY.");
  return new ClaudeModel(key, modelFor(feature, env, picks));
}

/** The batch model (M25): the fake in tests, else Claude Sonnet 5.5 through the Batch API. */
export function getBatchModel(env: Record<string, string | undefined> = process.env): TextBatchModel {
  if (aiIsFake(env)) return (g.__neolibraryFakeBatchModel ??= new FakeBatchModel());
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new AiNotConfigured("AI is not set up yet: the owner needs to add ANTHROPIC_API_KEY.");
  return new ClaudeBatchModel(key);
}
