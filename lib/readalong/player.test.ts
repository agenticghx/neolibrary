import { describe, expect, it } from "vitest";
import { afterEnded, BACK_TOLERANCE_MS, follow, SKIP_GAP_MS, WORD_TAIL_MS, type PlayerParagraph } from "./player";

// An audiobook in two files. In file 0: a paragraph, a second one after a
// half-second pause (plays through), a third after six seconds of audio that
// is not on the page (skipped). In file 1: two more paragraphs.
const ps: PlayerParagraph[] = [
  { file: 0, startMs: 1000, endMs: 2000, words: [[1000, 1400, 0, 3], [1500, 2000, 4, 9]] },
  { file: 0, startMs: 2500, endMs: 3000, words: [[2500, 3000, 0, 5]] },
  { file: 0, startMs: 9000, endMs: 9500, words: [[9000, 9500, 0, 5]] },
  { file: 1, startMs: 600, endMs: 1200, words: [[600, 1200, 0, 4]] },
  { file: 1, startMs: 1300, endMs: 2000, words: [[1300, 2000, 0, 4]] },
];

describe("following an uploaded audiobook as it plays (M13 (d))", () => {
  it("lights up each word from its start, and nothing before the paragraph's first word", () => {
    expect(follow(ps, 0, 0, 500)).toEqual({ kind: "play", index: 0, word: -1, ahead: null });
    expect(follow(ps, 0, 0, 1000)).toEqual({ kind: "play", index: 0, word: 0, ahead: null });
    expect(follow(ps, 0, 0, 1499)).toEqual({ kind: "play", index: 0, word: 0, ahead: null });
    expect(follow(ps, 0, 0, 1500)).toEqual({ kind: "play", index: 0, word: 1, ahead: null });
  });

  it("plays straight through a short pause into the next paragraph, without seeking", () => {
    expect(SKIP_GAP_MS).toBeGreaterThan(500);
    for (let t = 2000; t < 2500; t += 10) {
      // Once the last word's sound is over, the next paragraph's page may be turned to.
      expect(follow(ps, 0, 0, t)).toEqual({ kind: "play", index: 0, word: 1, ahead: t > 2000 + WORD_TAIL_MS ? 1 : null });
    }
    expect(follow(ps, 0, 0, 2500)).toEqual({ kind: "play", index: 1, word: 0, ahead: null });
    // From further back too: several paragraphs at once if the frames were slow.
    expect(follow(ps, 0, 0, 2600)).toEqual({ kind: "play", index: 1, word: 0, ahead: null });
  });

  it("skips a long stretch with nothing on the page, once the last word's sound is over", () => {
    expect(follow(ps, 1, 0, 3000 + WORD_TAIL_MS)).toEqual({ kind: "play", index: 1, word: 0, ahead: null });
    expect(follow(ps, 1, 0, 3000 + WORD_TAIL_MS + 1)).toEqual({ kind: "seek", index: 2, toMs: 9000 });
    // A seek that lands a few milliseconds early does not send the page back a paragraph.
    expect(follow(ps, 2, 0, 9000 - 5)).toEqual({ kind: "play", index: 2, word: -1, ahead: null });
    expect(follow(ps, 2, 0, 9000 - BACK_TOLERANCE_MS)).toEqual({ kind: "play", index: 2, word: -1, ahead: null });
    expect(follow(ps, 2, 0, 9000)).toEqual({ kind: "play", index: 2, word: 0, ahead: null });
  });

  it("follows the audio back when it is moved back", () => {
    expect(follow(ps, 2, 0, 1200)).toEqual({ kind: "play", index: 0, word: 0, ahead: null });
    expect(follow(ps, 1, 0, 2600)).toEqual({ kind: "play", index: 1, word: 0, ahead: null });
  });

  it("moves to the next file when this one has nothing more on the page, never into the other file's times", () => {
    // file 0's time 10 s is not file 1's: paragraph 3 starts at 0.6 s of file 1.
    expect(follow(ps, 2, 0, 9500 + WORD_TAIL_MS + 1)).toEqual({ kind: "play", index: 2, word: 0, ahead: 3 });
    expect(follow(ps, 2, 0, 9500 + SKIP_GAP_MS)).toEqual({ kind: "play", index: 2, word: 0, ahead: 3 });
    expect(follow(ps, 2, 0, 9500 + SKIP_GAP_MS + 1)).toEqual({ kind: "load", index: 3 });
    // Once file 1 is loaded and seeked to the paragraph's start.
    expect(follow(ps, 3, 1, 600)).toEqual({ kind: "play", index: 3, word: 0, ahead: null });
    expect(follow(ps, 3, 1, 1300)).toEqual({ kind: "play", index: 4, word: 0, ahead: null });
    // A file that ends sooner hands over at its end.
    expect(afterEnded(ps, 2, 0)).toBe(3);
    expect(afterEnded(ps, 0, 0)).toBe(3);
  });

  it("turns to the next paragraph's page as soon as this one's last word is over, before its first word", () => {
    // A new chapter or PDF page takes a moment to open: the spoken heading or pause before it gives that moment.
    expect(follow(ps, 0, 0, 1900)).toEqual({ kind: "play", index: 0, word: 1, ahead: null });
    expect(follow(ps, 0, 0, 2000 + WORD_TAIL_MS + 1)).toMatchObject({ kind: "play", index: 0, ahead: 1 });
    expect(follow(ps, 3, 1, 1250)).toMatchObject({ kind: "play", index: 3, ahead: null });
    // The last paragraph has nothing after it.
    expect(follow(ps, 4, 1, 9000)).toMatchObject({ kind: "play", index: 4, ahead: null });
  });

  it("stays on the last paragraph at the end of the audiobook, and stops when its file ends", () => {
    expect(follow(ps, 4, 1, 60_000)).toEqual({ kind: "play", index: 4, word: 0, ahead: null });
    expect(afterEnded(ps, 4, 1)).toBeNull();
    expect(afterEnded(ps, 3, 1)).toBeNull();
  });
});
