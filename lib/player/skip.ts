import { afterEnded, fileStart, follow, SKIP_GAP_MS, TURN_LEAD_MS, WORD_TAIL_MS, type PlayerParagraph } from "@/lib/readalong/player";

/**
 * Back or forward 15 s in an audiobook (M14 step 6b), counting only what is
 * played. Playing skips a long untimed stretch between two paragraphs of a
 * file (lib/readalong/player.ts, `follow`: it seeks from just after the
 * earlier paragraph to the later one), so a skip that ignored it could land
 * inside it, and the next frame would seek forward again: "back 15 s" would
 * do little or nothing. Here such a stretch counts for nothing and is never
 * landed in. The skip stays in the file that is loaded: it stops at the
 * file's start (0) and just before its end (`endMs`; at the end it reads on,
 * as playing would).
 */
export function skipInBook(ps: PlayerParagraph[], file: number, t: number, deltaMs: number, endMs: number): number {
  // The stretches playing jumps over in this file: [from, to).
  const jumps: [number, number][] = [];
  for (let i = 0; i + 1 < ps.length; i++) {
    const p = ps[i];
    const next = ps[i + 1];
    if (p.file === file && next.file === file && next.startMs - p.endMs > SKIP_GAP_MS) jumps.push([p.endMs + WORD_TAIL_MS + TURN_LEAD_MS, next.startMs]);
  }
  const last = Math.max(0, endMs - 50);
  let at = Math.min(Math.max(0, t), last);
  let left = Math.abs(deltaMs);
  if (deltaMs < 0) {
    // Inside a stretch (between frames, before playing jumps it): count from where it begins.
    for (const [from, to] of jumps) if (from < at && at < to) at = from;
    // Back: walk down, stepping over each stretch without counting it.
    for (const [from, to] of [...jumps].reverse()) {
      if (to > at) continue;
      if (at - left >= to) break;
      left -= at - to;
      at = from;
    }
    return Math.max(0, at - left);
  }
  for (const [from, to] of jumps) {
    if (to <= at) continue;
    // Inside a stretch (playing would jump it): start counting from its end.
    if (from <= at) {
      at = to;
      continue;
    }
    if (at + left < from) break;
    left -= from - at;
    at = to;
  }
  return Math.min(last, at + left);
}

/** The stretches playing jumps over in a file (a long untimed gap between two of its paragraphs): [from, to). */
function jumpsIn(ps: PlayerParagraph[], file: number): [number, number][] {
  const jumps: [number, number][] = [];
  for (let i = 0; i + 1 < ps.length; i++) {
    const p = ps[i];
    const next = ps[i + 1];
    if (p.file === file && next.file === file && next.startMs - p.endMs > SKIP_GAP_MS) jumps.push([p.endMs + WORD_TAIL_MS + TURN_LEAD_MS, next.startMs]);
  }
  return jumps;
}

/** How much of a file plays between two times (ms): the time between, less the stretches playing jumps over. */
function playedBetween(ps: PlayerParagraph[], file: number, from: number, to: number): number {
  let ms = Math.max(0, to - from);
  for (const [a, b] of jumpsIn(ps, file)) ms -= Math.max(0, Math.min(b, to) - Math.max(a, from));
  return ms;
}

/** The paragraph of `file` that time `t` is in (the last one begun by then), from `first` on. */
function paragraphAt(ps: PlayerParagraph[], first: number, file: number, t: number): number {
  let i = first;
  while (i + 1 < ps.length && ps[i + 1].file === file && ps[i + 1].startMs <= t) i++;
  return i;
}

export type SkipStep = { kind: "seek"; toMs: number } | { kind: "load"; index: number; toMs: number };

/**
 * Back or forward 15 s in an audiobook of several files (M14 step 6b, part
 * 2b), counting only what plays, as skipInBook does within one file:
 * - forward past where playing leaves this file (6 s after its last
 *   paragraph, as `follow` does, or its end), on into the next file from
 *   where playing would start it (fileStart);
 * - back past where this file began playing, into the file before, from its
 *   last paragraph's last word (WORD_TAIL_MS after it).
 * It goes only into files whose paragraphs are loaded: with no file after,
 * forward stops just before this file's end (which reads on); with none
 * before (the reading began in this file), back stops at its start.
 * `index`: the paragraph the player is in; `endMs`: this file's length.
 */
export function skipAcross(ps: PlayerParagraph[], index: number, file: number, t: number, deltaMs: number, endMs: number): SkipStep {
  const mine = ps.map((p, i) => [p, i] as const).filter(([p]) => p.file === file);
  if (!mine.length) return { kind: "seek", toMs: skipInBook(ps, file, t, deltaMs, endMs) };
  if (deltaMs >= 0) {
    const next = afterEnded(ps, index, file);
    if (next === null) return { kind: "seek", toMs: skipInBook(ps, file, t, deltaMs, endMs) };
    const leave = Math.min(endMs, mine[mine.length - 1][0].endMs + SKIP_GAP_MS);
    const land = skipInBook(ps, file, t, deltaMs, Number.POSITIVE_INFINITY);
    if (land < leave) return { kind: "seek", toMs: land };
    // On into the next file, with what is left over.
    const f = ps[next].file;
    const toMs = skipInBook(ps, f, fileStart(ps[next]), land - leave, Number.POSITIVE_INFINITY);
    return { kind: "load", index: paragraphAt(ps, next, f, toMs), toMs };
  }
  const [firstMine, first] = mine[0];
  const before = first > 0 ? ps[first - 1] : null;
  // Where this file began playing: from the file before, at fileStart; otherwise the reading began in it (0).
  const begin = before ? fileStart(firstMine) : 0;
  const back = -deltaMs;
  const here = playedBetween(ps, file, begin, Math.min(t, endMs));
  if (!before || back <= here) return { kind: "seek", toMs: Math.max(begin, skipInBook(ps, file, t, deltaMs, endMs)) };
  // Back into the file before, with what is left over, from its last word's end.
  const f = before.file;
  const from = before.endMs + WORD_TAIL_MS;
  const toMs = skipInBook(ps, f, from, -(back - here), from + 50);
  const firstThere = ps.findIndex((p) => p.file === f);
  return { kind: "load", index: paragraphAt(ps, firstThere, f, toMs), toMs };
}

/** True if `follow` would play on from `t` (no jump, no new file): where a skip may land. */
export const playsOnAt = (ps: PlayerParagraph[], index: number, file: number, t: number) => follow(ps, index, file, t).kind === "play";

/**
 * Back or forward in a made voice's clip (one paragraph): within it, or on to
 * the paragraph before (landing as far from its end as the skip went past
 * this one's start) or after (from its start). With nothing before, it stops
 * at 0; with nothing after, at the clip's end (which reads on, as playing would).
 */
export function skipInClip(
  t: number,
  deltaMs: number,
  durationMs: number,
  around: { prev: boolean; next: boolean },
): { kind: "seek"; toMs: number } | { kind: "previous"; fromEndMs: number } | { kind: "next" } {
  const to = t + deltaMs;
  if (to < 0) return around.prev ? { kind: "previous", fromEndMs: -to } : { kind: "seek", toMs: 0 };
  if (to >= durationMs) return around.next ? { kind: "next" } : { kind: "seek", toMs: Math.max(0, durationMs - 50) };
  return { kind: "seek", toMs: to };
}
