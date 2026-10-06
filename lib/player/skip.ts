import { follow, SKIP_GAP_MS, TURN_LEAD_MS, WORD_TAIL_MS, type PlayerParagraph } from "@/lib/readalong/player";

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
