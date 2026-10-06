import { describe, expect, it } from "vitest";
import type { Annotation } from "@/lib/library/annotations";
import { noteShown } from "./ContinueCard";
import { marksText, progressLabel, spineFoot, spineWidth } from "./Library";

describe("progress and spines", () => {
  it("labels progress", () => {
    expect([progressLabel(0), progressLabel(0.344), progressLabel(1)]).toEqual(["Not started", "34% read", "Finished"]);
  });

  it("sizes a spine by pages, else by file size, else the middle width", () => {
    expect([spineWidth(100), spineWidth(200), spineWidth(400), spineWidth(500), spineWidth(900)]).toEqual([1, 2, 3, 4, 5]);
    expect([spineWidth(null, 100 * 1024), spineWidth(null, 400 * 1024), spineWidth(null, 3 * 1024 * 1024)]).toEqual([1, 2, 5]);
    expect(spineWidth(null, null)).toBe(3);
  });

  it("writes New, a percentage or Done at a spine's foot, and nothing for a title not available yet", () => {
    const read = { read: true, listen: false };
    expect(spineFoot({ available: read, progress: 0 })).toBe("New");
    expect(spineFoot({ available: read, progress: 0.5 })).toBe("50%");
    expect(spineFoot({ available: read, progress: 1 })).toBe("Done");
    expect(spineFoot({ available: { read: false, listen: false }, progress: 0 })).toBe("");
  });

  it("puts the cover marks into words for screen readers", () => {
    expect(marksText({ notes: true, audiobook: true })).toBe("has your notes, has your audiobook");
    expect(marksText({ notes: false, audiobook: false })).toBe("");
  });
});

describe("the note on a Continue card", () => {
  const base = { quote: { exact: "", prefix: "", suffix: "" }, body: "", voice: null } as unknown as Annotation;
  it("shows a highlight's quote, a note's words, a voice note's transcript", () => {
    expect(noteShown({ ...base, kind: "highlight", quote: { exact: "a quoted line", prefix: "", suffix: "" } })).toEqual({ label: "Your last highlight here", text: "a quoted line", highlight: true });
    expect(noteShown({ ...base, kind: "note", body: "my thought" })).toEqual({ label: "Your last note here", text: "my thought", highlight: false });
    expect(noteShown({ ...base, kind: "voice", voice: { audioKey: "a", mime: "audio/webm", durationMs: 1, transcript: "said aloud" } }).text).toBe("said aloud");
    expect(noteShown({ ...base, kind: "voice", voice: { audioKey: "a", mime: "audio/webm", durationMs: 1, transcript: "" } }).text).toBe("A voice note");
  });

  it("clips long words to 220 characters", () => {
    const shown = noteShown({ ...base, kind: "note", body: "x".repeat(300) });
    expect(shown.text).toHaveLength(221);
    expect(shown.text.endsWith("…")).toBe(true);
  });
});
