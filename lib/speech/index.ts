import { ElevenLabsSpeech } from "./elevenlabs";
import { FakeSpeech } from "./fake";
import { SpeechNotConfigured, type SpeechModel } from "./model";

/** The voice the app uses: the fake in tests (and with AI_FAKE=1), ElevenLabs with a key, otherwise none. */
const g = globalThis as unknown as { __neolibraryFakeSpeech?: FakeSpeech };

export function getSpeechModel(env: Record<string, string | undefined> = process.env): SpeechModel {
  if (env.AI_FAKE === "1" || env.VITEST) return (g.__neolibraryFakeSpeech ??= new FakeSpeech());
  const key = env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new SpeechNotConfigured("Reading aloud is not set up yet: the owner needs to add ELEVENLABS_API_KEY.");
  return new ElevenLabsSpeech(key);
}
