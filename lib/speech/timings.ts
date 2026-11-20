import type { Alignment } from "./model";

/**
 * Word timings for the highlight that follows the voice (M7): for each word
 * of the text, when it starts and ends (milliseconds) and where it is in the
 * text (character offsets, end exclusive). Built from per-character timings.
 */
export type WordTiming = [startMs: number, endMs: number, from: number, to: number];

export function wordTimings(text: string, a: Alignment): WordTiming[] {
  // ElevenLabs gives one entry per Unicode code point, while string slices use UTF-16 offsets.
  const out: WordTiming[] = [];
  let utf16At = 0;
  let cpAt = 0;
  for (const m of text.matchAll(/\S+/g)) {
    const from = m.index!;
    const to = from + m[0].length;
    for (const ch of text.slice(utf16At, from)) {
      void ch;
      cpAt += 1;
    }
    const cpFrom = cpAt;
    for (const ch of m[0]) {
      void ch;
      cpAt += 1;
    }
    utf16At = to;
    const start = a.starts[cpFrom];
    const end = a.ends[cpAt - 1];
    if (start === undefined || end === undefined) break;
    out.push([Math.round(start * 1000), Math.round(end * 1000), from, to]);
  }
  return out;
}

/** The word being spoken at a time (ms), or -1 before the first word. Binary search. */
export function wordAt(words: WordTiming[], ms: number) {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid][0] <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
