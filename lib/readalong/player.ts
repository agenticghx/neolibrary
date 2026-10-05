import { wordAt, type WordTiming } from "@/lib/speech/timings";

/**
 * M13 (d): following an uploaded audiobook as it plays. The audio is one long
 * file per chapter (or per book); the paragraphs that have word times are
 * stretches of it. The Listen bar asks `follow` on every frame which paragraph
 * and word the audio is at, and what to do about it. Pure, so it is tested on
 * its own (player.test.ts); the bar only carries the answer out.
 *
 * The audio plays straight on from one paragraph into the next: seeking costs
 * time (Safari's engine takes 1 to 2 s when the bytes are not downloaded yet),
 * and what is between paragraphs usually belongs to the reading: pauses, a
 * chapter title read aloud, a word the matcher could not place on the page.
 * Only a long stretch with nothing on the page (a footnote or a passage the
 * book does not print, an introduction) is skipped.
 */
export type PlayerParagraph = { file: number; startMs: number; endMs: number; words: WordTiming[] };

/**
 * Audio with no words on the page that lasts longer than this, between two
 * paragraphs of the same file, is skipped. Anything shorter plays: a pause,
 * a chapter title ("Chapter Two. The Route to Normal Science." is 3 or 4 s),
 * a paragraph's last words that did not get times.
 */
export const SKIP_GAP_MS = 6000;
/** After a paragraph's last word, this much more plays before a long gap is skipped (the end of the word's sound). */
export const WORD_TAIL_MS = 250;
/**
 * The page turns to the next paragraph as soon as this one's last word is
 * over; a skip waits this much longer, so that a new chapter (or PDF page),
 * which takes a moment to open, is there when the next word is spoken.
 */
export const TURN_LEAD_MS = 600;
/**
 * The audio must be this far before a paragraph's start before the player
 * counts it as back in the paragraph before: a seek lands a few
 * milliseconds early in some audio formats, and that must not send the page
 * back a paragraph.
 */
export const BACK_TOLERANCE_MS = 300;

export type FollowStep =
  /**
   * Keep playing; highlight `word` of paragraph `index` (-1: before its
   * first word). `ahead`: the next paragraph, once this one's last word is
   * over: turn to its page now, so that a new chapter (or PDF page), which
   * takes a moment to open, is there when its first word is spoken.
   */
  | { kind: "play"; index: number; word: number; ahead: number | null }
  /** Skip a long untimed gap in the same file: seek to `toMs`, now in paragraph `index`. */
  | { kind: "seek"; index: number; toMs: number }
  /** Paragraph `index` is in another file and this one has nothing more to show: load it and play on. */
  | { kind: "load"; index: number };

/**
 * Where the audio is: `index` is the paragraph the player was in, `file` the
 * file loaded in the audio element, `t` the element's time (ms).
 */
export function follow(ps: PlayerParagraph[], index: number, file: number, t: number): FollowStep {
  let i = Math.min(Math.max(index, 0), ps.length - 1);
  // On into the next paragraph of this file once its first word has begun...
  while (i + 1 < ps.length && ps[i + 1].file === file && t >= ps[i + 1].startMs) i++;
  // ...or back, if the audio was moved back (not by a seek landing a hair early).
  while (i > 0 && ps[i - 1].file === file && t < ps[i].startMs - BACK_TOLERANCE_MS) i--;
  const p = ps[i];
  const next = ps[i + 1];
  if (next && next.file === file && next.startMs - p.endMs > SKIP_GAP_MS && t > p.endMs + WORD_TAIL_MS + TURN_LEAD_MS) {
    return { kind: "seek", index: i + 1, toMs: next.startMs };
  }
  if (next && next.file !== file && t > p.endMs + SKIP_GAP_MS) return { kind: "load", index: i + 1 };
  return { kind: "play", index: i, word: wordAt(p.words, t), ahead: next && t > p.endMs ? i + 1 : null };
}

/** When the file ends: the paragraph to load next (the next one, in another file), or null to stop. */
export function afterEnded(ps: PlayerParagraph[], index: number, file: number): number | null {
  for (let i = Math.max(index, 0); i < ps.length; i++) if (ps[i].file !== file) return i;
  return null;
}

/**
 * Where to start a new file when the audiobook reads on into it (ms): from
 * the file's beginning, so its chapter title is heard, unless the file has a
 * long stretch before its first paragraph (then at that paragraph).
 */
export function fileStart(p: PlayerParagraph): number {
  return p.startMs <= SKIP_GAP_MS ? 0 : p.startMs;
}
