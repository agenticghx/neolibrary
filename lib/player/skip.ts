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
  const last = Math.max(0, endMs - 50);
  let at = Math.min(Math.max(0, t), last);
  if (deltaMs < 0) return Math.max(0, backFrom(ps, file, at, -deltaMs));
  // Forward, over the stretches playing jumps over in this file: [from, to).
  let left = deltaMs;
  for (const [from, to] of jumpsIn(ps, file)) {
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

/**
 * Back `back` ms from `t` in a file, counting only what plays: where it lands, below 0 when it would go back
 * past the file's start (callers stop it there).
 */
function backFrom(ps: PlayerParagraph[], file: number, t: number, back: number): number {
  const jumps = jumpsIn(ps, file);
  let at = t;
  let left = back;
  // Inside a stretch (between frames, before playing jumps it): count from where it begins.
  for (const [from, to] of jumps) if (from < at && at < to) at = from;
  // Back: walk down, stepping over each stretch without counting it.
  for (const [from, to] of [...jumps].reverse()) {
    if (to > at) continue;
    if (at - left >= to) break;
    left -= at - to;
    at = from;
  }
  return at - left;
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

/** Where a skip goes: a time in the file loaded (`seek`), or paragraph `index`'s file from `toMs` (`load`). */
export type SkipStep = { kind: "seek"; toMs: number } | { kind: "load"; index: number; toMs: number };
/**
 * Back past the first paragraph loaded, with more of the audiobook before it: where it lands depends on
 * paragraphs not loaded yet, so load the part before them first, then ask again.
 */
export type NeedsEarlier = { kind: "earlier" };

/**
 * Back or forward 15 s in an audiobook of several files (M14 step 6b, part
 * 2b), counting only what plays, as skipInBook does within one file:
 * - forward past where playing leaves this file (6 s after its last
 *   paragraph, as `follow` does, or its end), on into the next file from
 *   where playing would start it (fileStart);
 * - back past where this file began playing, into the file before, from its
 *   last paragraph's last word (WORD_TAIL_MS after it).
 * Another file is counted only up to its last word's end (its length is not
 * known before it loads): forward carries on through a file too short to
 * hold the rest. It goes only into files whose paragraphs are loaded: with no
 * file after, forward stops just before this file's end (which reads on), or
 * at the last word's end of the last file loaded; with none before (the
 * reading began in this file), back stops at its start.
 * `earlier` (M14, back into a chapter not loaded): more of the audiobook comes
 * before the first paragraph loaded. A back skip that would land before that
 * paragraph's start (in this file, or in the file before when that file holds
 * it) then answers `earlier`: once the part before is loaded, the same skip
 * lands where it would have landed had that part been loaded all along.
 * `index`: the paragraph the player is in; `endMs`: this file's length.
 */
export function skipAcross(ps: PlayerParagraph[], index: number, file: number, t: number, deltaMs: number, endMs: number): SkipStep;
export function skipAcross(ps: PlayerParagraph[], index: number, file: number, t: number, deltaMs: number, endMs: number, earlier: boolean): SkipStep | NeedsEarlier;
export function skipAcross(ps: PlayerParagraph[], index: number, file: number, t: number, deltaMs: number, endMs: number, earlier = false): SkipStep | NeedsEarlier {
  const mine = ps.map((p, i) => [p, i] as const).filter(([p]) => p.file === file);
  if (!mine.length) return { kind: "seek", toMs: skipInBook(ps, file, t, deltaMs, endMs) };
  if (deltaMs >= 0) {
    let next = afterEnded(ps, index, file);
    if (next === null) return { kind: "seek", toMs: skipInBook(ps, file, t, deltaMs, endMs) };
    const leave = Math.min(endMs, mine[mine.length - 1][0].endMs + SKIP_GAP_MS);
    const land = skipInBook(ps, file, t, deltaMs, Number.POSITIVE_INFINITY);
    if (land < leave) return { kind: "seek", toMs: land };
    // On into the next file with what is left over, and on through any file too short to hold it. A file's
    // length is not known before it loads: it is counted up to its last word's end, where its audio surely is,
    // so the landing never falls where playing would leave the file (or past its end).
    let left = land - leave;
    for (;;) {
      const f = ps[next].file;
      const start = fileStart(ps[next]);
      let last = next;
      while (last + 1 < ps.length && ps[last + 1].file === f) last++;
      const cap = Math.max(start, ps[last].endMs + WORD_TAIL_MS);
      const toMs = skipInBook(ps, f, start, left, Number.POSITIVE_INFINITY);
      if (toMs < cap) return { kind: "load", index: paragraphAt(ps, next, f, toMs), toMs };
      const after = afterEnded(ps, next, f);
      if (after === null) return { kind: "load", index: last, toMs: cap };
      left -= playedBetween(ps, f, start, cap);
      next = after;
    }
  }
  const [firstMine, first] = mine[0];
  const before = first > 0 ? ps[first - 1] : null;
  // Where this file began playing: from the file before, at fileStart; otherwise the reading began in it (0).
  const begin = before ? fileStart(firstMine) : 0;
  const back = -deltaMs;
  const here = playedBetween(ps, file, begin, Math.min(t, endMs));
  if (!before || back <= here) {
    const land = backFrom(ps, file, Math.min(Math.max(0, t), Math.max(0, endMs - 50)), back);
    // Back past the first paragraph loaded, which is this file's: the paragraphs before it are needed first.
    if (earlier && first === 0 && land < ps[0].startMs) return { kind: "earlier" };
    return { kind: "seek", toMs: Math.max(begin, land, 0) };
  }
  // Back into the file before, with what is left over, from its last word's end; no further back than where that
  // file began playing (as for this one), so it never lands in an opening stretch that playing skips.
  const f = before.file;
  const from = before.endMs + WORD_TAIL_MS;
  const firstThere = ps.findIndex((p) => p.file === f);
  const land = backFrom(ps, f, from, back - here);
  // Back past the first paragraph loaded, which is that file's: likewise.
  if (earlier && firstThere === 0 && land < ps[0].startMs) return { kind: "earlier" };
  const beginThere = firstThere > 0 ? fileStart(ps[firstThere]) : 0;
  const toMs = Math.max(beginThere, land, 0);
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
