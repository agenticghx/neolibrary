import type { SpeechModel, SpeechRequest, SpeechResult, Voice } from "./model";

/**
 * The fake voice used in every test (ground rule 3): a quiet tone as a real
 * WAV file, made in code, lasting 0.03 s per character with every character
 * timed evenly, so the word highlight can be checked against known times.
 * It counts its calls.
 */
export const FAKE_SECONDS_PER_CHAR = 0.03;

export class FakeSpeech implements SpeechModel {
  readonly provider = "elevenlabs";
  readonly model = "fake-voice";
  calls: SpeechRequest[] = [];

  async voices(): Promise<Voice[]> {
    return [
      { id: "fake-ada", name: "Ada (test voice)" },
      { id: "fake-ben", name: "Ben (test voice)" },
    ];
  }

  async speak(req: SpeechRequest): Promise<SpeechResult> {
    this.calls.push(req);
    const characters = req.text.split("");
    const starts = characters.map((_, i) => round(i * FAKE_SECONDS_PER_CHAR));
    const ends = characters.map((_, i) => round((i + 1) * FAKE_SECONDS_PER_CHAR));
    return {
      audio: wav(characters.length * FAKE_SECONDS_PER_CHAR),
      mime: "audio/wav",
      alignment: { characters, starts, ends },
      characters: req.text.length,
    };
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A mono 8 kHz 16-bit WAV: a soft 440 Hz tone, so a player has something to play. */
export function wav(seconds: number): Uint8Array {
  const rate = 8000;
  const n = Math.max(1, Math.round(seconds * rate));
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (o: number, s: string) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  buf.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true); // PCM
  buf.setUint16(22, 1, true); // mono
  buf.setUint32(24, rate, true);
  buf.setUint32(28, rate * 2, true);
  buf.setUint16(32, 2, true);
  buf.setUint16(34, 16, true);
  text(36, "data");
  buf.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) buf.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 600), true);
  return new Uint8Array(buf.buffer);
}
