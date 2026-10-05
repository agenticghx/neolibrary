import { describe, expect, it } from "vitest";
import { afterEnded, BACK_TOLERANCE_MS, fileStart, follow, SKIP_GAP_MS, TURN_LEAD_MS, WORD_TAIL_MS, type PlayerParagraph } from "./player";

// An audiobook in two files. In file 0: a paragraph, a second one after a
// half-second pause (plays through), a third after nine seconds of audio
// that is not on the page (skipped). In file 1: two more paragraphs.
const ps: PlayerParagraph[] = [
  { file: 0, startMs: 1000, endMs: 2000, words: [[1000, 1400, 0, 3], [1500, 2000, 4, 9]] },
  { file: 0, startMs: 2500, endMs: 3000, words: [[2500, 3000, 0, 5]] },
  { file: 0, startMs: 12000, endMs: 12500, words: [[12000, 12500, 0, 5]] },
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

  it("plays straight through a pause into the next paragraph, turning to its page as soon as the last word is over", () => {
    for (let t = 2000; t < 2500; t += 10) expect(follow(ps, 0, 0, t)).toEqual({ kind: "play", index: 0, word: 1, ahead: t > 2000 ? 1 : null });
    expect(follow(ps, 0, 0, 2500)).toEqual({ kind: "play", index: 1, word: 0, ahead: null });
    // From further back too: several paragraphs at once if the frames were slow.
    expect(follow(ps, 0, 0, 2600)).toEqual({ kind: "play", index: 1, word: 0, ahead: null });
  });

  it("plays what lies between paragraphs when it could be reading: words without times, a chapter title", () => {
    expect(SKIP_GAP_MS).toBeGreaterThanOrEqual(5000);
    // A paragraph whose last word got no time (a footnote mark glued to it, say): 1.6 s to the next paragraph.
    const cut: PlayerParagraph[] = [
      { file: 0, startMs: 1000, endMs: 10000, words: [[1000, 10000, 0, 4]] },
      { file: 0, startMs: 11600, endMs: 12000, words: [[11600, 12000, 0, 4]] },
    ];
    for (let t = 10000; t < 11600; t += 50) expect(follow(cut, 0, 0, t).kind).toBe("play");
    // A chapter title read aloud between chapters: 4 s.
    const title: PlayerParagraph[] = [
      { file: 0, startMs: 40000, endMs: 50000, words: [[40000, 50000, 0, 4]] },
      { file: 0, startMs: 54000, endMs: 60000, words: [[54000, 60000, 0, 4]] },
    ];
    for (let t = 50000; t < 54000; t += 50) expect(follow(title, 0, 0, t)).toMatchObject({ kind: "play", ahead: t > 50000 ? 1 : null });
  });

  it("skips a long stretch with nothing on the page, once the page has had time to turn", () => {
    // The page turns at the last word's end; the skip comes a little later.
    expect(follow(ps, 1, 0, 3001)).toEqual({ kind: "play", index: 1, word: 0, ahead: 2 });
    expect(follow(ps, 1, 0, 3000 + WORD_TAIL_MS + TURN_LEAD_MS)).toEqual({ kind: "play", index: 1, word: 0, ahead: 2 });
    expect(follow(ps, 1, 0, 3000 + WORD_TAIL_MS + TURN_LEAD_MS + 1)).toEqual({ kind: "seek", index: 2, toMs: 12000 });
    // A seek that lands a few milliseconds early does not send the page back a paragraph.
    expect(follow(ps, 2, 0, 12000 - 5)).toEqual({ kind: "play", index: 2, word: -1, ahead: null });
    expect(follow(ps, 2, 0, 12000 - BACK_TOLERANCE_MS)).toEqual({ kind: "play", index: 2, word: -1, ahead: null });
    expect(follow(ps, 2, 0, 12000)).toEqual({ kind: "play", index: 2, word: 0, ahead: null });
  });

  it("follows the audio back when it is moved back", () => {
    expect(follow(ps, 2, 0, 1200)).toEqual({ kind: "play", index: 0, word: 0, ahead: null });
    expect(follow(ps, 1, 0, 2600)).toEqual({ kind: "play", index: 1, word: 0, ahead: null });
  });

  it("moves to the next file when this one has nothing more on the page, never into the other file's times", () => {
    // file 0's time 13 s is not file 1's: paragraph 3 starts at 0.6 s of file 1.
    expect(follow(ps, 2, 0, 12500 + WORD_TAIL_MS + 1)).toEqual({ kind: "play", index: 2, word: 0, ahead: 3 });
    expect(follow(ps, 2, 0, 12500 + SKIP_GAP_MS)).toEqual({ kind: "play", index: 2, word: 0, ahead: 3 });
    expect(follow(ps, 2, 0, 12500 + SKIP_GAP_MS + 1)).toEqual({ kind: "load", index: 3 });
    // Once file 1 is loaded and playing.
    expect(follow(ps, 3, 1, 600)).toEqual({ kind: "play", index: 3, word: 0, ahead: null });
    expect(follow(ps, 3, 1, 1300)).toEqual({ kind: "play", index: 4, word: 0, ahead: null });
    // A file that ends sooner hands over at its end.
    expect(afterEnded(ps, 2, 0)).toBe(3);
    expect(afterEnded(ps, 0, 0)).toBe(3);
  });

  it("starts a new file from its beginning, so its chapter title is heard, unless a long stretch comes first", () => {
    expect(fileStart(ps[3])).toBe(0);
    expect(fileStart({ file: 2, startMs: SKIP_GAP_MS, endMs: 9000, words: [] })).toBe(0);
    expect(fileStart({ file: 2, startMs: SKIP_GAP_MS + 1, endMs: 9000, words: [] })).toBe(SKIP_GAP_MS + 1);
  });

  it("stays on the last paragraph at the end of the audiobook, and stops when its file ends", () => {
    expect(follow(ps, 4, 1, 60_000)).toEqual({ kind: "play", index: 4, word: 0, ahead: null });
    expect(afterEnded(ps, 4, 1)).toBeNull();
    expect(afterEnded(ps, 3, 1)).toBeNull();
  });
});
