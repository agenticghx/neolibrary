import { describe, expect, it } from "vitest";
import { ClaudeModel } from "./claude";
import { getTextModel } from "./index";
import { AiError, AiNotConfigured, AiRefused, costUsd, modelFor, type AiFeature } from "./model";
import { FakeModel } from "./fake";
import { estimateCost } from "./generate";

// No real key and no network: a stand-in for the API answers instead (ground rule 3).
const KEY = "not-a-real-key";

function fakeApi(body: Record<string, unknown>, status = 200) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const message = (over: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: " A plainer paragraph. " }],
  stop_reason: "end_turn",
  stop_details: null,
  usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  ...over,
});

const req = { system: "Rewrite.", prompt: "<passage>Text.</passage>", maxTokens: 4000, effort: "low" as const };

describe("ClaudeModel", () => {
  it("sends the current model with adaptive thinking, the effort level, server-side fallbacks and a cached system prompt", async () => {
    const api = fakeApi(message());
    const out = await new ClaudeModel(KEY, undefined, { fetch: api.fetch }).generate(req);
    expect(out).toEqual({ text: "A plainer paragraph.", model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 300, cache: { write: 0, read: 0 } });
    const sent = api.requests[0];
    expect(sent.url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(sent.headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    expect(sent.headers.get("x-api-key")).toBe(KEY);
    expect(sent.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      fallbacks: "default",
      thinking: { type: "adaptive", display: "omitted" },
      output_config: { effort: "low" },
      system: [{ type: "text", text: "Rewrite.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "<passage>Text.</passage>" }],
    });
  });

  it("counts tokens written to and read from the prompt cache as input, and reports them apart", async () => {
    const usage = { input_tokens: 900, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 6000 };
    const api = fakeApi(message({ usage }));
    const out = await new ClaudeModel(KEY, undefined, { fetch: api.fetch }).generate(req);
    expect(out.inputTokens).toBe(6900);
    expect(out.cache).toEqual({ write: 0, read: 6000 });
    const first = fakeApi(message({ usage: { ...usage, cache_creation_input_tokens: 6000, cache_read_input_tokens: 0 } }));
    expect((await new ClaudeModel(KEY, undefined, { fetch: first.fetch }).generate(req)).cache).toEqual({ write: 6000, read: 0 });
  });

  it("asks for structured output (JSON matching a schema) when given one", async () => {
    const api = fakeApi(message({ content: [{ type: "text", text: '{"concepts":[]}' }] }));
    const schema = { type: "object", properties: { concepts: { type: "array" } }, required: ["concepts"], additionalProperties: false };
    const out = await new ClaudeModel(KEY, undefined, { fetch: api.fetch }).generate({ ...req, effort: "medium", schema });
    expect(out.text).toBe('{"concepts":[]}');
    expect(api.requests[0].body.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema } });
  });

  it("records the model that actually answered when a fallback stepped in", async () => {
    const api = fakeApi(message({ model: "claude-opus-4-8" }));
    const out = await new ClaudeModel(KEY, undefined, { fetch: api.fetch }).generate(req);
    expect(out.model).toBe("claude-opus-4-8");
  });

  it("reports a refusal or a cut-off answer instead of storing it", async () => {
    const refused = fakeApi(message({ stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "Declined." }, content: [] }));
    await expect(new ClaudeModel(KEY, undefined, { fetch: refused.fetch }).generate(req)).rejects.toThrow(AiRefused);
    const cut = fakeApi(message({ stop_reason: "max_tokens" }));
    await expect(new ClaudeModel(KEY, undefined, { fetch: cut.fetch }).generate(req)).rejects.toThrow("cut off");
  });

  it("turns API errors into plain messages", async () => {
    const api = fakeApi({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401);
    await expect(new ClaudeModel(KEY, undefined, { fetch: api.fetch }).generate(req)).rejects.toThrow(
      new AiError("The Anthropic API key was refused."),
    );
  });
});

describe("costs and choosing a model", () => {
  it("prices tokens per million, and unknown models at the highest known price", () => {
    expect(costUsd("claude-opus-5-5", 1_000_000, 1_000_000)).toBe(24);
    expect(costUsd("claude-opus-5-5", 1200, 300)).toBeCloseTo(0.0108);
    expect(costUsd("some-new-model", 1_000_000, 0)).toBe(10);
    // Haiku 5.5: $0.10 and $0.50, five times that once the prompt passes 100,000 tokens.
    expect(costUsd("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(3);
    expect(costUsd("claude-haiku-5-5", 100_000, 1000)).toBeCloseTo(0.0105);
    expect(costUsd("claude-haiku-5-5", 100_001, 1000)).toBeCloseTo(0.0525, 4);
  });

  it("prices prompt-cache writes at 1.25 times the input price and reads at the model's cache price", () => {
    // Opus 5.5: input $4, a cache write $5, a cache read $0.20 (a twentieth).
    expect(costUsd("claude-opus-5-5", 1_000_000, 0, { write: 1_000_000, read: 0 })).toBeCloseTo(5);
    expect(costUsd("claude-opus-5-5", 1_000_000, 0, { write: 0, read: 1_000_000 })).toBeCloseTo(0.2);
    // Sonnet 5.5 reads are also a twentieth ($0.10); Haiku 5.5 and Opus 5 a tenth.
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 0, { write: 0, read: 1_000_000 })).toBeCloseTo(0.1);
    expect(costUsd("claude-haiku-5-5", 100_000, 0, { write: 0, read: 100_000 })).toBeCloseTo(0.001);
    expect(costUsd("claude-haiku-5-5", 100_000, 0, { write: 100_000, read: 0 })).toBeCloseTo(0.0125);
    expect(costUsd("claude-opus-5", 1_000_000, 0, { write: 0, read: 1_000_000 })).toBeCloseTo(0.5);
    // The rest of the input is at the full price; no cache figures means no cache.
    expect(costUsd("claude-opus-5-5", 7900, 0, { write: 0, read: 6000 })).toBeCloseTo((1900 * 4 + 6000 * 0.2) / 1e6);
    expect(costUsd("claude-opus-5-5", 7900, 300)).toBe(costUsd("claude-opus-5-5", 7900, 300, { write: 0, read: 0 }));
    // Haiku's long-prompt prices start past 100,000 tokens of prompt, cached ones included.
    expect(costUsd("claude-haiku-5-5", 120_000, 0, { write: 0, read: 100_000 })).toBeCloseTo((20_000 * 0.5 + 100_000 * 0.05) / 1e6);
    // An unknown model is priced high: reads at $1, writes at $12.50.
    expect(costUsd("some-new-model", 1_000_000, 0, { write: 1_000_000, read: 0 })).toBe(12.5);
  });

  it("estimates before a call as if the prompt cache missed and the system prompt was written to it", () => {
    const model = new ClaudeModel(KEY, "claude-opus-5-5");
    const system = "x".repeat(24_000); // 6,000 tokens by the four-characters rule
    const est = estimateCost(model, { system, prompt: "y".repeat(4000), input: "y".repeat(4000), maxTokens: 4000 });
    expect(est).toBeCloseTo((6000 * 5 + 1000 * 4 + 3000 * 20) / 1e6);
    expect(est).toBeGreaterThan(costUsd("claude-opus-5-5", 7000, 3000));
  });

  it("uses the fake in tests or with AI_FAKE=1, Claude with a key, and refuses to pretend without one", () => {
    expect(getTextModel("rewrite")).toBeInstanceOf(FakeModel);
    expect(getTextModel("rewrite", { AI_FAKE: "1" })).toBeInstanceOf(FakeModel);
    expect(getTextModel("rewrite", { ANTHROPIC_API_KEY: KEY })).toBeInstanceOf(ClaudeModel);
    expect(() => getTextModel("rewrite", {})).toThrow(AiNotConfigured);
    expect(() => getTextModel("rewrite", { ANTHROPIC_API_KEY: "  " })).toThrow("ANTHROPIC_API_KEY");
  });

  it("gives Test yourself and Need to know Haiku, rewrites Sonnet, judging features Opus, each changeable by a setting", () => {
    const model = (feature: AiFeature, env: Record<string, string> = {}) => getTextModel(feature, { ANTHROPIC_API_KEY: KEY, ...env }).model;
    expect(model("rewrite")).toBe("claude-sonnet-5-5");
    expect(model("prerequisites")).toBe("claude-haiku-5-5");
    expect(model("questions")).toBe("claude-haiku-5-5");
    expect(model("ask")).toBe("claude-opus-5-5");
    expect(model("explain-back")).toBe("claude-opus-5-5");
    expect(model("rewrite", { AI_MODEL_REWRITE: "claude-opus-5-5" })).toBe("claude-opus-5-5");
    expect(model("explain-back", { AI_MODEL_EXPLAIN_BACK: "claude-haiku-5-5" })).toBe("claude-haiku-5-5");
    // A misspelt or unpriced model is ignored, so the spending cap always knows the price.
    expect(model("ask", { AI_MODEL_ASK: "claude-opus-9" })).toBe("claude-opus-5-5");
    expect(modelFor("questions", { AI_MODEL_QUESTIONS: " claude-opus-5-5 " })).toBe("claude-opus-5-5");
    // M35: the owner's pick on the Spending page wins over the server setting; an unpriced pick is ignored.
    expect(modelFor("explain-back", { AI_MODEL_EXPLAIN_BACK: "claude-haiku-5-5" }, { "explain-back": "claude-sonnet-5-5" })).toBe("claude-sonnet-5-5");
    expect(modelFor("explain-back", {}, { "explain-back": "claude-opus-9" })).toBe("claude-opus-5-5");
    expect(getTextModel("questions", { ANTHROPIC_API_KEY: KEY }, { questions: "claude-opus-5-5" }).model).toBe("claude-opus-5-5");
  });

  it("sends Haiku no server-side fallback, which it does not have", async () => {
    const api = fakeApi(message({ model: "claude-haiku-5-5" }));
    const out = await new ClaudeModel(KEY, "claude-haiku-5-5", { fetch: api.fetch }).generate(req);
    expect(out.model).toBe("claude-haiku-5-5");
    const sent = api.requests[0];
    expect(sent.headers.get("anthropic-beta")).toBeNull();
    expect(sent.body).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 4000,
      thinking: { type: "adaptive", display: "omitted" },
      output_config: { effort: "low" },
      system: [{ type: "text", text: "Rewrite.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "<passage>Text.</passage>" }],
    });
  });
});
