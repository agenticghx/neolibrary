import { describe, expect, it } from "vitest";
import { ClaudeModel } from "./claude";
import { getTextModel } from "./index";
import { AiError, AiNotConfigured, AiRefused, costUsd } from "./model";
import { FakeModel } from "./fake";

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
  it("sends the current model with adaptive thinking, the effort level and server-side fallbacks", async () => {
    const api = fakeApi(message());
    const out = await new ClaudeModel(KEY, undefined, { fetch: api.fetch }).generate(req);
    expect(out).toEqual({ text: "A plainer paragraph.", model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 300 });
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
      system: "Rewrite.",
      messages: [{ role: "user", content: "<passage>Text.</passage>" }],
    });
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
  });

  it("uses the fake in tests or with AI_FAKE=1, Claude with a key, and refuses to pretend without one", () => {
    expect(getTextModel()).toBeInstanceOf(FakeModel);
    expect(getTextModel({ AI_FAKE: "1" })).toBeInstanceOf(FakeModel);
    expect(getTextModel({ ANTHROPIC_API_KEY: KEY })).toBeInstanceOf(ClaudeModel);
    expect(() => getTextModel({})).toThrow(AiNotConfigured);
    expect(() => getTextModel({ ANTHROPIC_API_KEY: "  " })).toThrow("ANTHROPIC_API_KEY");
  });
});
