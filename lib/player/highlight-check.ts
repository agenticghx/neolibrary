/**
 * How the read-aloud browser tests judge the word highlight (Samuel's choice
 * (b), 2026-10-09, PROGRESS.md Open unknowns row 14). Test code; the app does
 * not use it.
 *
 * The highlight moves only when the page redraws (about 60 times a second).
 * On a busy machine one redraw can come late enough that a short word is
 * said entirely between two redraws: nothing could light it. So a word may
 * be missing only when no redraw happened while it was the word being said
 * (from its start until the next word's start, a few milliseconds in from
 * each end, since the page and the test read the audio's clock at slightly
 * different moments). Every other word must be lit, in order, within
 * `lateMs` of when the voice starts it, and nothing else may be lit.
 */

/** A word the voice says: when it starts, and when the next word starts (ms, the audio's clock). */
export type Said = { word: string; startMs: number; endMs: number };
/** A change of the lit word, and the audio's clock at that moment (ms). */
export type Shown = { word: string; atMs: number };

export type HighlightCheck =
  | { ok: true; lit: number; skipped: { word: string; startMs: number; endMs: number }[] }
  | { ok: false; reason: string };

export function checkHighlight(said: Said[], shown: Shown[], redrawsMs: number[], opts: { lateMs?: number; marginMs?: number } = {}): HighlightCheck {
  const lateMs = opts.lateMs ?? 100;
  const marginMs = opts.marginMs ?? 5;
  const redrawnDuring = (s: Said) => redrawsMs.some((t) => t >= s.startMs + marginMs && t < s.endMs - marginMs);
  const skipped: { word: string; startMs: number; endMs: number }[] = [];
  let k = 0;
  for (const s of said) {
    const next = shown[k];
    if (next?.word === s.word) {
      const late = next.atMs - s.startMs;
      if (late >= lateMs) return { ok: false, reason: `"${s.word}" was lit ${Math.round(late)} ms after the voice started it (limit ${lateMs} ms)` };
      if (late < -1) return { ok: false, reason: `"${s.word}" was lit ${Math.round(-late)} ms before the voice started it` };
      k++;
    } else if (redrawnDuring(s)) {
      return {
        ok: false,
        reason: `"${s.word}" (${Math.round(s.startMs)}-${Math.round(s.endMs)} ms) was not lit, though the page redrew while it was said; lit next: ${next ? `"${next.word}"` : "nothing"}`,
      };
    } else skipped.push({ word: s.word, startMs: s.startMs, endMs: s.endMs });
  }
  if (k < shown.length) return { ok: false, reason: `lit but not said next: ${shown.slice(k, k + 5).map((s) => `"${s.word}"`).join(", ")}` };
  return { ok: true, lit: k, skipped };
}
