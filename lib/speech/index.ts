import { ElevenLabsSpeech } from "./elevenlabs";
import { FakeSpeech } from "./fake";
import { OWN_KEY_SUFFIX, ownKeyFrom } from "@/lib/ai/own-key";
import { OWN_KEY_NEEDED } from "@/lib/own-key-names";
import { SpeechNotConfigured, type SpeechModel } from "./model";
import { ElevenLabsTranscriber, getTranscriber, type Transcriber } from "./transcribe";

/**
 * The voice the app uses: the fake in tests (and with AI_FAKE=1), ElevenLabs
 * with a key, otherwise none. One ElevenLabs client per key is kept, so its
 * voice list is kept between requests too.
 */
const g = globalThis as unknown as { __neolibraryFakeSpeech?: FakeSpeech; __neolibraryElevenLabs?: Map<string, ElevenLabsSpeech> };

export function getSpeechModel(env: Record<string, string | undefined> = process.env): SpeechModel {
  if (env.AI_FAKE === "1" || env.VITEST) return (g.__neolibraryFakeSpeech ??= new FakeSpeech());
  const key = env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new SpeechNotConfigured("Reading aloud is not set up yet: the owner needs to add ELEVENLABS_API_KEY.");
  const clients = (g.__neolibraryElevenLabs ??= new Map());
  let model = clients.get(key);
  if (!model) clients.set(key, (model = new ElevenLabsSpeech(key)));
  return model;
}

/**
 * M34 S4: the voice for whoever asks. The owner (the admin) uses the library's key; anyone else only the ElevenLabs
 * key their request carries (lib/ai/own-key.ts), its provider marked as their own so it never counts against the
 * owner's voice spending or caps. Without one, SpeechNotConfigured says how to add it.
 */
export function speechModelFor(who: { role: string }, req: Request, env: Record<string, string | undefined> = process.env): SpeechModel {
  if (who.role === "admin") return getSpeechModel(env);
  const key = ownKeyFrom(req, "voice");
  if (!key) throw new SpeechNotConfigured(OWN_KEY_NEEDED.voice);
  const inner = env.AI_FAKE === "1" || env.VITEST ? getSpeechModel(env) : new ElevenLabsSpeech(key);
  return { provider: inner.provider + OWN_KEY_SUFFIX, model: inner.model, voices: () => inner.voices(), speak: (r) => inner.speak(r) };
}

/** The same for a voice note's transcript: the owner's key for the owner, else the note-taker's own, else none. */
export function transcriberFor(who: { role: string }, req: Request, env: Record<string, string | undefined> = process.env): Transcriber {
  if (who.role === "admin") return getTranscriber(env);
  const key = ownKeyFrom(req, "voice");
  if (!key) throw new SpeechNotConfigured(OWN_KEY_NEEDED.voice);
  const inner = env.AI_FAKE === "1" || env.VITEST ? getTranscriber(env) : new ElevenLabsTranscriber(key);
  return { provider: inner.provider + OWN_KEY_SUFFIX, model: inner.model, transcribe: (audio, mime) => inner.transcribe(audio, mime) };
}
