import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FakeImageGenerator, getImageGenerator, ImageGenerationNotConfigured, imageUsd, OpenAIImages, png } from "./generate";

// No real key and no network: a stand-in for the OpenAI API (ground rule 3).
const KEY = "not-a-real-key";
function openai(body: unknown, status = 200) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, requests };
}

describe("OpenAIImages", () => {
  it("asks the current image model for one PNG and returns its bytes", async () => {
    const picture = png(4, 4, [10, 20, 30]);
    const api = openai({ created: 1, data: [{ b64_json: Buffer.from(picture).toString("base64") }] });
    const out = await new OpenAIImages(KEY, undefined, { fetch: api.fetcher }).generate("A silicon wafer.");
    expect(out).toEqual({ data: picture, mime: "image/png" });
    expect(api.requests[0].url).toMatch(/\/v1\/images\/generations$/);
    expect(api.requests[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(api.requests[0].body).toEqual({ model: "gpt-image-2", prompt: "A silicon wafer.", n: 1, size: "1024x1024", quality: "medium", output_format: "png" });
  });

  it("explains a refused key, a refused prompt and an empty answer", async () => {
    const refused = openai({ error: { message: "bad key", type: "invalid_request_error" } }, 401);
    await expect(new OpenAIImages(KEY, undefined, { fetch: refused.fetcher }).generate("x")).rejects.toThrow("The OpenAI API key was refused.");
    const declined = openai({ error: { message: "safety", type: "invalid_request_error" } }, 400);
    await expect(new OpenAIImages(KEY, undefined, { fetch: declined.fetcher }).generate("x")).rejects.toThrow("would not draw");
    const empty = openai({ created: 1, data: [] });
    await expect(new OpenAIImages(KEY, undefined, { fetch: empty.fetcher }).generate("x")).rejects.toThrow("no picture");
  });
});

describe("the fake picture and choosing a generator", () => {
  it("draws a valid PNG of the right size in code", async () => {
    const { data, mime } = await new FakeImageGenerator().generate("wafer");
    expect(mime).toBe("image/png");
    const buf = Buffer.from(data);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([96, 64]);
    const idatLength = buf.readUInt32BE(33);
    expect(inflateSync(buf.subarray(41, 41 + idatLength)).length).toBe((96 * 3 + 1) * 64);
  });

  it("uses the fake in tests or with AI_FAKE=1, OpenAI with a key, refuses to pretend without one, and prices pictures", () => {
    expect(getImageGenerator()).toBeInstanceOf(FakeImageGenerator);
    expect(getImageGenerator({ OPENAI_API_KEY: KEY })).toBeInstanceOf(OpenAIImages);
    expect(() => getImageGenerator({})).toThrow(ImageGenerationNotConfigured);
    expect(imageUsd({})).toBe(0.2);
    expect(imageUsd({ OPENAI_IMAGE_USD: "0.07" })).toBe(0.07);
  });
});
