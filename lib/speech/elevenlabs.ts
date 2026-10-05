import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";
import { SpeechError, type SpeechModel, type SpeechRequest, type SpeechResult, type Voice } from "./model";

export const ELEVENLABS_MODEL = "eleven_multilingual_v2";

/** Two of ElevenLabs' ready-made voices, used when the account's voice list cannot be read. */
export const DEFAULT_VOICES: Voice[] = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
];

/**
 * The account's voice list rarely changes: it is asked for at most every ten
 * minutes, and never waited on for more than a few seconds (with no retry),
 * so a slow ElevenLabs cannot hold up the Listen bar, where the reader's own
 * audiobook plays without ElevenLabs at all (M13 (d)).
 */
export const VOICES_FOR_MS = 10 * 60 * 1000;
export const VOICES_WAIT_SECONDS = 3;

/** ElevenLabs text-to-speech with character timings (the "with timestamps" endpoint). */
export class ElevenLabsSpeech implements SpeechModel {
  readonly provider = "elevenlabs";
  private client: ElevenLabsClient;
  private voiceList: { at: number; voices: Voice[] } | null = null;

  constructor(
    apiKey: string,
    readonly model = ELEVENLABS_MODEL,
    options: { fetch?: typeof fetch; baseUrl?: string } = {},
  ) {
    this.client = new ElevenLabsClient({ apiKey, maxRetries: 2, ...options });
  }

  async voices(now = Date.now()): Promise<Voice[]> {
    if (this.voiceList && now - this.voiceList.at < VOICES_FOR_MS) return this.voiceList.voices;
    try {
      const res = await this.client.voices.getAll({}, { timeoutInSeconds: VOICES_WAIT_SECONDS, maxRetries: 0 });
      const list = res.voices.map((v) => ({ id: v.voiceId, name: v.name ?? v.voiceId }));
      this.voiceList = { at: now, voices: list.length ? list : DEFAULT_VOICES };
      return this.voiceList.voices;
    } catch {
      // Not kept: the next request asks again.
      return DEFAULT_VOICES;
    }
  }

  async speak(req: SpeechRequest): Promise<SpeechResult> {
    let res;
    try {
      res = await this.client.textToSpeech.convertWithTimestamps(req.voiceId, {
        text: req.text,
        modelId: this.model,
        outputFormat: "mp3_44100_128",
        ...(req.previousText ? { previousText: req.previousText } : {}),
        ...(req.nextText ? { nextText: req.nextText } : {}),
      });
    } catch (e) {
      if (e instanceof ElevenLabsError) {
        if (e.statusCode === 401) throw new SpeechError("The ElevenLabs API key was refused.");
        if (e.statusCode === 429) throw new SpeechError("ElevenLabs is busy (rate limit). Try again in a minute.");
        throw new SpeechError(`ElevenLabs could not read this aloud (${e.statusCode ?? "network"}).`);
      }
      throw e;
    }
    const a = res.alignment;
    if (!res.audioBase64 || !a) throw new SpeechError("ElevenLabs returned no audio.");
    return {
      audio: new Uint8Array(Buffer.from(res.audioBase64, "base64")),
      mime: "audio/mpeg",
      alignment: { characters: a.characters, starts: a.characterStartTimesSeconds, ends: a.characterEndTimesSeconds },
      characters: req.text.length,
    };
  }
}
