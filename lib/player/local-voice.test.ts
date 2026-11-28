import { describe, expect, it } from "vitest";
import { estimateWordTimings, isLocalVoice, LOCAL_VOICES, localVoiceKey } from "./local-voice";

describe("local-voice helpers", () => {
  it("recognizes local: voices and extracts the Kokoro voice key", () => {
    expect(isLocalVoice("local:af_heart")).toBe(true);
    expect(isLocalVoice("upload:123")).toBe(false);
    expect(isLocalVoice("JBFqnCBsd6RMkjVDRZzb")).toBe(false);
    expect(localVoiceKey("local:af_heart")).toBe("af_heart");
    expect(localVoiceKey("local:bm_george")).toBe("bm_george");
    expect(LOCAL_VOICES.length).toBeGreaterThanOrEqual(3);
  });

  it("estimates monotonic word timings spanning the full audio duration", () => {
    const text = "Hello world. This is a test!";
    const timings = estimateWordTimings(text, 3000);
    expect(timings).toHaveLength(6);
    expect(timings[0][0]).toBe(0);
    expect(timings.at(-1)![1]).toBe(3000);
    for (let i = 0; i < timings.length; i++) {
      const [start, end, from, to] = timings[i];
      expect(end).toBeGreaterThan(start);
      expect(text.slice(from, to)).toBe(text.split(" ")[i]);
      if (i > 0) expect(start).toBeGreaterThanOrEqual(timings[i - 1][0]);
    }
  });

  it("returns empty timings for blank text or zero duration", () => {
    expect(estimateWordTimings("   ", 2000)).toEqual([]);
    expect(estimateWordTimings("Hello", 0)).toEqual([]);
  });
});
