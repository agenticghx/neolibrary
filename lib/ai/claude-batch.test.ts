import { describe, expect, it } from "vitest";
import { batchCostUsd, FakeBatchModel, TRANSCRIBE_MODEL, type BatchRequest } from "./batch";
import { ClaudeBatchModel } from "./claude-batch";
import { getBatchModel } from "./index";
import { AiError, AiNotConfigured } from "./model";

// No real key and no network: a stand-in for the Batches API answers instead (ground rule 3).
const KEY = "not-a-real-key";
const RESULTS_URL = "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results";

const batch = (over: Record<string, unknown> = {}) => ({
  id: "msgbatch_1",
  type: "message_batch",
  processing_status: "in_progress",
  request_counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
  results_url: null,
  created_at: "2026-10-15T16:00:00Z",
  expires_at: "2026-10-16T16:00:00Z",
  ended_at: null,
  cancel_initiated_at: null,
  archived_at: null,
  ...over,
});

const message = (text: string, over: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text }],
  stop_reason: "end_turn",
  stop_details: null,
  usage: { input_tokens: 4270, output_tokens: 700, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  ...over,
});

/** Answers each address the SDK asks for; records what was sent. */
function fakeApi(routes: Record<string, () => Response>) {
  const requests: { method: string; url: string; headers: Headers; body: unknown }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const u = String(url);
    requests.push({ method, url: u, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
    const key = `${method} ${new URL(u).pathname}`;
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ type: "error", error: { type: "not_found_error", message: key } }), { status: 404 });
    return route();
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const jsonl = (lines: unknown[]) => new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { headers: { "content-type": "application/binary" } });

const page = (id: string): BatchRequest => ({ id, images: [{ mediaType: "image/png", base64: "iVBORw0KGgo=" }], prompt: "Transcribe this page.", maxTokens: 8000 });

describe("ClaudeBatchModel", () => {
  it("sends each page as an image before the instructions, Sonnet 5.5, under our own ids, with no fallback", async () => {
    const api = fakeApi({ "POST /v1/messages/batches": () => json(batch()) });
    const id = await new ClaudeBatchModel(KEY, undefined, { fetch: api.fetch }).submit([page("p-0001"), page("p-0002")]);
    expect(id).toBe("msgbatch_1");
    const sent = api.requests[0];
    expect(sent.headers.get("x-api-key")).toBe(KEY);
    expect(sent.headers.get("anthropic-beta")).toBeNull();
    expect(sent.body).toEqual({
      requests: ["p-0001", "p-0002"].map((custom_id) => ({
        custom_id,
        params: {
          model: TRANSCRIBE_MODEL,
          max_tokens: 8000,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
                { type: "text", text: "Transcribe this page." },
              ],
            },
          ],
        },
      })),
    });
  });

  it("reports a batch's progress", async () => {
    const api = fakeApi({
      "GET /v1/messages/batches/msgbatch_1": () =>
        json(batch({ processing_status: "ended", request_counts: { processing: 0, succeeded: 1, errored: 1, canceled: 1, expired: 1 }, results_url: RESULTS_URL })),
    });
    expect(await new ClaudeBatchModel(KEY, undefined, { fetch: api.fetch }).status("msgbatch_1")).toEqual({
      id: "msgbatch_1",
      state: "ended",
      counts: { processing: 0, succeeded: 1, errored: 1, canceled: 1, expired: 1 },
    });
  });

  it("reads every outcome: an answer, a refusal, a cut-off answer, a failed, a cancelled and an expired request", async () => {
    const api = fakeApi({
      "GET /v1/messages/batches/msgbatch_1": () => json(batch({ processing_status: "ended", results_url: RESULTS_URL })),
      "GET /v1/messages/batches/msgbatch_1/results": () =>
        jsonl([
          { custom_id: "p-0001", result: { type: "succeeded", message: message(" # Chapter\n\nText. ") } },
          { custom_id: "p-0002", result: { type: "succeeded", message: message("", { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "Declined." } }) } },
          { custom_id: "p-0003", result: { type: "succeeded", message: message("Half a pa", { stop_reason: "max_tokens" }) } },
          { custom_id: "p-0004", result: { type: "errored", error: { type: "error", error: { type: "invalid_request_error", message: "Image too large." } } } },
          { custom_id: "p-0005", result: { type: "canceled" } },
          { custom_id: "p-0006", result: { type: "expired" } },
        ]),
    });
    const used = { model: "claude-sonnet-5-5", inputTokens: 4270, outputTokens: 700 };
    expect(await new ClaudeBatchModel(KEY, undefined, { fetch: api.fetch }).results("msgbatch_1")).toEqual([
      { id: "p-0001", kind: "succeeded", text: "# Chapter\n\nText.", ...used },
      { id: "p-0002", kind: "refused", message: "Declined.", ...used },
      { id: "p-0003", kind: "errored", message: "The answer was cut off before it finished.", ...used },
      { id: "p-0004", kind: "errored", message: "Image too large." },
      { id: "p-0005", kind: "canceled" },
      { id: "p-0006", kind: "expired" },
    ]);
  });

  it("cancels a batch", async () => {
    const api = fakeApi({ "POST /v1/messages/batches/msgbatch_1/cancel": () => json(batch({ processing_status: "canceling" })) });
    await new ClaudeBatchModel(KEY, undefined, { fetch: api.fetch }).cancel("msgbatch_1");
    expect(api.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(["POST /v1/messages/batches/msgbatch_1/cancel"]);
  });

  it("turns API failures into messages a reader can act on", async () => {
    const api = fakeApi({ "POST /v1/messages/batches": () => json({ type: "error", error: { type: "authentication_error", message: "bad key" } }, 401) });
    await expect(new ClaudeBatchModel(KEY, undefined, { fetch: api.fetch }).submit([page("p-0001")])).rejects.toThrow(new AiError("The Anthropic API key was refused."));
  });
});

describe("batch prices and the model the app uses", () => {
  it("charges half the usual price: about $0.0078 for a measured Sonnet page", () => {
    expect(batchCostUsd("claude-sonnet-5-5", 4270, 700)).toBeCloseTo(0.00777, 5);
  });

  it("uses the fake in tests and needs a key otherwise", () => {
    expect(getBatchModel({ VITEST: "true" })).toBeInstanceOf(FakeBatchModel);
    expect(() => getBatchModel({})).toThrow(AiNotConfigured);
    expect(getBatchModel({ ANTHROPIC_API_KEY: KEY })).toBeInstanceOf(ClaudeBatchModel);
    expect(getBatchModel({ ANTHROPIC_API_KEY: KEY }).model).toBe("claude-sonnet-5-5");
  });
});

describe("FakeBatchModel", () => {
  it("answers when the batch ends, and a cancelled batch answers nothing", async () => {
    const fake = new FakeBatchModel({ pollsUntilEnded: 1, answer: (r) => (r.id === "p-0002" ? { id: r.id, kind: "refused", message: "No." } : `Text of ${r.id}.`) });
    const id = await fake.submit([page("p-0001"), page("p-0002")]);
    expect((await fake.status(id)).state).toBe("in_progress");
    expect(await fake.status(id)).toMatchObject({ state: "ended", counts: { succeeded: 1, errored: 1 } });
    expect((await fake.results(id)).map((r) => r.kind)).toEqual(["succeeded", "refused"]);
    const other = await fake.submit([page("p-0003")]);
    await fake.cancel(other);
    expect(await fake.results(other)).toEqual([{ id: "p-0003", kind: "canceled" }]);
  });
});
