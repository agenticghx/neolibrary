/**
 * The voice interface (M7, ground rule 3). The app only talks to this:
 * `ElevenLabsSpeech` calls ElevenLabs, `FakeSpeech` makes a short audio file
 * in code with evenly spread timings, for tests, and costs nothing.
 */
export type Voice = { id: string; name: string };

/** When each character of the text is spoken, in seconds (ElevenLabs' "alignment"). */
export type Alignment = { characters: string[]; starts: number[]; ends: number[] };

export type SpeechRequest = {
  text: string;
  voiceId: string;
  /** The text either side, so joined clips sound continuous. */
  previousText?: string;
  nextText?: string;
};

export type SpeechResult = {
  audio: Uint8Array;
  mime: string;
  alignment: Alignment;
  /** Characters billed. */
  characters: number;
};

export interface SpeechModel {
  readonly provider: string;
  readonly model: string;
  voices(): Promise<Voice[]>;
  speak(req: SpeechRequest): Promise<SpeechResult>;
}

export class SpeechError extends Error {}
export class SpeechNotConfigured extends SpeechError {}

/**
 * US dollars per 1,000 characters. ElevenLabs bills characters against a plan;
 * the default is a cautious overage price, set ELEVENLABS_USD_PER_1K_CHARS to
 * match the real plan.
 */
export function usdPer1kChars(env: Record<string, string | undefined> = process.env) {
  const v = Number(env.ELEVENLABS_USD_PER_1K_CHARS);
  return Number.isFinite(v) && v > 0 ? v : 0.3;
}

export const speechCost = (characters: number, env?: Record<string, string | undefined>) => (characters / 1000) * usdPer1kChars(env);
