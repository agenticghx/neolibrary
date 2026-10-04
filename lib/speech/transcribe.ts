import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";
import { SpeechError, SpeechNotConfigured } from "./model";

/**
 * Speech to text for voice notes (M8, ground rule 3): ElevenLabs' Scribe, or a
 * fake for tests. Uses the ElevenLabs key already set for reading aloud, so
 * no extra provider is needed.
 */
export interface Transcriber {
  readonly provider: string;
  readonly model: string;
  transcribe(audio: Uint8Array, mime: string): Promise<string>;
}

export const SCRIBE_MODEL = "scribe_v2";

export class ElevenLabsTranscriber implements Transcriber {
  readonly provider = "elevenlabs";
  private client: ElevenLabsClient;

  constructor(
    apiKey: string,
    readonly model = SCRIBE_MODEL,
    options: { fetch?: typeof fetch } = {},
  ) {
    this.client = new ElevenLabsClient({ apiKey, maxRetries: 2, ...options });
  }

  async transcribe(audio: Uint8Array, mime: string): Promise<string> {
    try {
      const res = await this.client.speechToText.convert({
        modelId: this.model,
        file: new Blob([new Uint8Array(audio)], { type: mime }),
        tagAudioEvents: false,
      });
      if (!("text" in res) || typeof res.text !== "string") throw new SpeechError("ElevenLabs returned no transcript.");
      return res.text.trim();
    } catch (e) {
      if (e instanceof ElevenLabsError) {
        if (e.statusCode === 401) throw new SpeechError("The ElevenLabs API key was refused.");
        throw new SpeechError(`ElevenLabs could not transcribe this (${e.statusCode ?? "network"}).`);
      }
      throw e;
    }
  }
}

/** The fake: a fixed sentence that says how much audio it got, and counts its calls. */
export class FakeTranscriber implements Transcriber {
  readonly provider = "elevenlabs";
  readonly model = "fake-scribe";
  calls = 0;

  async transcribe(audio: Uint8Array): Promise<string> {
    this.calls += 1;
    return `Test transcript of a voice note (${audio.length} bytes of audio).`;
  }
}

const g = globalThis as unknown as { __neolibraryFakeTranscriber?: FakeTranscriber };

export function getTranscriber(env: Record<string, string | undefined> = process.env): Transcriber {
  if (env.AI_FAKE === "1" || env.VITEST) return (g.__neolibraryFakeTranscriber ??= new FakeTranscriber());
  const key = env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new SpeechNotConfigured("Transcripts are not set up yet: the owner needs to add ELEVENLABS_API_KEY.");
  return new ElevenLabsTranscriber(key);
}

/** US dollars per hour of audio transcribed (set ELEVENLABS_STT_USD_PER_HOUR to the plan's price; cautious default $1). */
export function sttUsdPerHour(env: Record<string, string | undefined> = process.env) {
  const v = Number(env.ELEVENLABS_STT_USD_PER_HOUR);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export const sttCost = (durationMs: number, env?: Record<string, string | undefined>) => (durationMs / 3_600_000) * sttUsdPerHour(env);
