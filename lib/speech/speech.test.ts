import { describe, expect, it } from "vitest";
import { DEFAULT_VOICES, ElevenLabsSpeech, VOICES_FOR_MS, VOICES_WAIT_SECONDS } from "./elevenlabs";
import { FakeSpeech, wav } from "./fake";
import { getSpeechModel } from "./index";
import { SpeechNotConfigured, speechCost, usdPer1kChars } from "./model";
import { wordAt, wordTimings } from "./timings";

// No real key and no network: a stand-in for the ElevenLabs API (ground rule 3).
const KEY = "not-a-real-key";

function fakeApi(handler: (url: string, body: unknown) => { status?: number; body: unknown }) {
  const requests: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: String(url), method: init?.method ?? "GET", headers: new Headers(init?.headers), body });
    const out = handler(String(url), body);
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

describe("ElevenLabsSpeech", () => {
  it("asks for speech with character timings, and returns the audio and alignment", async () => {
    const audio = Buffer.from("ID3 fake mp3 bytes");
    const api = fakeApi(() => ({
      body: {
        audio_base64: audio.toString("base64"),
        alignment: { characters: ["H", "i", "."], character_start_times_seconds: [0, 0.1, 0.2], character_end_times_seconds: [0.1, 0.2, 0.3] },
      },
    }));
    const out = await new ElevenLabsSpeech(KEY, undefined, { fetch: api.fetch }).speak({ text: "Hi.", voiceId: "JBFqnCBsd6RMkjVDRZzb", nextText: "More." });
    expect(Buffer.from(out.audio).toString()).toBe("ID3 fake mp3 bytes");
    expect(out).toMatchObject({ mime: "audio/mpeg", characters: 3, alignment: { characters: ["H", "i", "."], starts: [0, 0.1, 0.2], ends: [0.1, 0.2, 0.3] } });
    const sent = api.requests[0];
    expect(sent.method).toBe("POST");
    expect(sent.url).toMatch(/\/v1\/text-to-speech\/JBFqnCBsd6RMkjVDRZzb\/with-timestamps\?output_format=mp3_44100_128$/);
    expect(sent.headers.get("xi-api-key")).toBe(KEY);
    expect(sent.body).toEqual({ text: "Hi.", model_id: "eleven_multilingual_v2", next_text: "More." });
  });

  it("asks for the voice list at most every ten minutes, and waits for it at most a few seconds, without retrying", async () => {
    let asked = 0;
    const api = fakeApi(() => {
      asked++;
      return { body: { voices: [{ voice_id: "v1", name: "Grace" }] } };
    });
    const model = new ElevenLabsSpeech(KEY, undefined, { fetch: api.fetch });
    expect(await model.voices(0)).toEqual([{ id: "v1", name: "Grace" }]);
    expect(await model.voices(VOICES_FOR_MS - 1)).toEqual([{ id: "v1", name: "Grace" }]);
    expect(asked).toBe(1);
    await model.voices(VOICES_FOR_MS);
    expect(asked).toBe(2);
    // ElevenLabs does not answer: the ready-made voices after a few seconds, asked once.
    let hung = 0;
    const silent = (async (_url: string | URL | Request, init?: RequestInit) => {
      hung++;
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    }) as typeof globalThis.fetch;
    const started = Date.now();
    expect(await new ElevenLabsSpeech(KEY, undefined, { fetch: silent }).voices()).toEqual(DEFAULT_VOICES);
    expect(Date.now() - started).toBeLessThan((VOICES_WAIT_SECONDS + 2) * 1000);
    expect(hung).toBe(1);
  }, 15_000);

  it("lists the account's voices, or two ready-made ones if that fails, and explains errors", async () => {
    const ok = fakeApi(() => ({ body: { voices: [{ voice_id: "v1", name: "Grace" }] } }));
    expect(await new ElevenLabsSpeech(KEY, undefined, { fetch: ok.fetch }).voices()).toEqual([{ id: "v1", name: "Grace" }]);
    const down = fakeApi(() => ({ status: 500, body: {} }));
    expect(await new ElevenLabsSpeech(KEY, undefined, { fetch: down.fetch }).voices()).toEqual(DEFAULT_VOICES);
    const refused = fakeApi(() => ({ status: 401, body: { detail: "invalid key" } }));
    await expect(new ElevenLabsSpeech(KEY, undefined, { fetch: refused.fetch }).speak({ text: "Hi.", voiceId: "x" })).rejects.toThrow(
      "The ElevenLabs API key was refused.",
    );
  });
});

describe("timings, costs and choosing a voice", () => {
  it("turns character timings into word timings, and finds the word at a time", () => {
    const text = "Mr. Utterson  the lawyer";
    const n = text.length;
    const a = { characters: text.split(""), starts: [...Array(n).keys()].map((i) => i / 10), ends: [...Array(n).keys()].map((i) => (i + 1) / 10) };
    const words = wordTimings(text, a);
    expect(words).toEqual([
      [0, 300, 0, 3],
      [400, 1200, 4, 12],
      [1400, 1700, 14, 17],
      [1800, 2400, 18, 24],
    ]);
    expect([-1, 0, 350, 400, 1300, 5000].map((ms) => wordAt(words, ms))).toEqual([-1, 0, 0, 1, 1, 3]);
  });

  it("prices characters (default $0.30 per 1,000, or the plan's price) and makes a playable WAV", () => {
    expect(usdPer1kChars({})).toBe(0.3);
    expect(usdPer1kChars({ ELEVENLABS_USD_PER_1K_CHARS: "0.18" })).toBe(0.18);
    expect(speechCost(2000, {})).toBeCloseTo(0.6);
    const w = wav(0.5);
    expect(new TextDecoder().decode(w.slice(0, 4))).toBe("RIFF");
    expect(w.length).toBe(44 + 0.5 * 8000 * 2);
  });

  it("uses the fake voice in tests or with AI_FAKE=1, ElevenLabs with a key, and refuses to pretend without one", () => {
    expect(getSpeechModel()).toBeInstanceOf(FakeSpeech);
    expect(getSpeechModel({ AI_FAKE: "1" })).toBeInstanceOf(FakeSpeech);
    expect(getSpeechModel({ ELEVENLABS_API_KEY: KEY })).toBeInstanceOf(ElevenLabsSpeech);
    // One client per key, so its voice list is kept between requests.
    expect(getSpeechModel({ ELEVENLABS_API_KEY: KEY })).toBe(getSpeechModel({ ELEVENLABS_API_KEY: KEY }));
    expect(getSpeechModel({ ELEVENLABS_API_KEY: "another-key" })).not.toBe(getSpeechModel({ ELEVENLABS_API_KEY: KEY }));
    expect(() => getSpeechModel({})).toThrow(SpeechNotConfigured);
  });
});
