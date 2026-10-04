import { ClaudeModel } from "./claude";
import { FakeModel } from "./fake";
import { AiNotConfigured, type TextModel } from "./model";

/**
 * The model the app uses. Tests (and the browser tests, via AI_FAKE=1) get
 * the fake; otherwise a real key is required. With no key the app says so
 * instead of inventing output.
 */
const g = globalThis as unknown as { __neolibraryFakeModel?: FakeModel };

export function aiIsFake(env: Record<string, string | undefined> = process.env) {
  return env.AI_FAKE === "1" || Boolean(env.VITEST);
}

export function getTextModel(env: Record<string, string | undefined> = process.env): TextModel {
  if (aiIsFake(env)) return (g.__neolibraryFakeModel ??= new FakeModel());
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new AiNotConfigured("AI is not set up yet: the owner needs to add ANTHROPIC_API_KEY.");
  return new ClaudeModel(key);
}
