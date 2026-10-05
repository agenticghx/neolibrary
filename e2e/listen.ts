import { expect, type Page } from "@playwright/test";

/**
 * Plays the open "Read aloud" bar for 3 seconds of audio and checks that the
 * highlight moved to every word of `text` (the paragraph's opening) in order,
 * each within a tenth of a second of when the voice starts it. The fake voice
 * gives 0.03 s per character, so a word starts at 0.03 s × its offset.
 * Logs how often the browser fired "timeupdate", the event the highlight
 * used to follow (Samuel, 2026-10-04: the highlight did not keep up).
 */
export async function expectHighlightKeepsUp(page: Page, text: string) {
  const bar = page.getByRole("region", { name: "Read aloud" });
  // Record each word the highlight moves to, with the audio's clock at that moment.
  await page.evaluate(() => {
    const w = window as unknown as { seen: [string, number][]; ticks: number[] };
    w.seen = [];
    w.ticks = [];
    const a = document.querySelector("audio")!;
    a.addEventListener("timeupdate", () => w.ticks.push(performance.now()));
    const el = document.querySelector('[aria-label="Read aloud"]')!;
    new MutationObserver(() => {
      const word = el.getAttribute("data-word") ?? "";
      if (word) w.seen.push([word, a.currentTime]);
    }).observe(el, { attributes: true, attributeFilter: ["data-word"] });
  });
  await bar.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => document.querySelector("audio")!.currentTime > 3, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.querySelector("audio")!.pause());
  const { seen, ticks } = await page.evaluate(() => {
    const w = window as unknown as { seen: [string, number][]; ticks: number[] };
    return { seen: w.seen, ticks: w.ticks };
  });
  const gaps = ticks
    .slice(1)
    .map((t, i) => t - ticks[i])
    .sort((a, b) => a - b);
  console.log(`timeupdate fired every ${Math.round(gaps[gaps.length >> 1])} ms (median); highlight moved ${seen.length} times`);

  const words = [...text.matchAll(/\S+/g)].map((m) => ({ word: m[0], startMs: m.index! * 30 }));
  const reached = seen[seen.length - 1][1] * 1000;
  const expected = words.filter((w) => w.startMs <= reached);
  expect(expected.length).toBeGreaterThan(15);
  // Every word, in order: none skipped.
  expect(seen.map(([w]) => w)).toEqual(expected.map((w) => w.word));
  // Each shown within a tenth of a second of when the voice starts it.
  for (let i = 0; i < seen.length; i++) expect(seen[i][1] * 1000 - expected[i].startMs, `"${seen[i][0]}"`).toBeLessThan(100);
}

/**
 * One frame of an audiobook playing: the audio's time (s), the bar's word and
 * paragraph, the text lit in the book, whether paused, which audio file (the
 * number at the end of its address), and where the reader is (its CFI).
 */
export type Frame = [time: number, word: string, passage: string, lit: string | null, paused: boolean, file: number, where: string];

/**
 * Records, on every frame from now on, where the open "Read aloud" bar's
 * audio is and what is lit up, reading the CSS Custom Highlight in the
 * book's own frame (so a browser without that API cannot pass), and every
 * event of the audio element (M13 (d)).
 */
export async function recordPlayer(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { frames_: unknown[]; events_: [string, number][] };
    w.frames_ = [];
    w.events_ = [];
    const a = document.querySelector("audio")!;
    for (const e of ["loadstart", "emptied", "abort", "seeking", "seeked", "waiting", "playing", "play", "pause", "ended", "error", "stalled"]) {
      a.addEventListener(e, () => w.events_.push([e, a.currentTime]));
    }
    const bar = document.querySelector('[aria-label="Read aloud"]')!;
    const reader = document.querySelector('[data-testid="reader"]')!;
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    const lit = () => {
      for (const { doc } of view.renderer.getContents()) {
        const h = (doc.defaultView as unknown as { CSS: { highlights?: Map<string, Set<Range>> } }).CSS.highlights?.get("nl-spoken");
        if (h) return [...h].map((r) => r.toString()).join(" ");
      }
      return null;
    };
    requestAnimationFrame(function tick() {
      const file = Number(/\/audio\/(\d+)$/.exec(a.getAttribute("src") ?? "")?.[1] ?? -1);
      w.frames_.push([a.currentTime, bar.getAttribute("data-word") ?? "", bar.getAttribute("data-passage") ?? "", lit(), a.paused, file, reader.getAttribute("data-cfi") ?? ""]);
      requestAnimationFrame(tick);
    });
  });
}

export async function recording(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { frames_: Frame[]; events_: [string, number][] };
    return { frames: w.frames_, events: w.events_ };
  });
}

/** A word the audiobook says on the page: its text, when it starts (ms in its audio file), its file, and its paragraph's CFI. */
export type Spoken = { word: string; startMs: number; file: number; cfi: string };

/** Each value a column took, in order, with the frame where it first showed (repeats collapsed). */
function changes(frames: Frame[], col: 1 | 2 | 3) {
  const out: { value: string; frame: Frame }[] = [];
  for (const f of frames) {
    const v = (f[col] as string | null) ?? "";
    if (v && out.at(-1)?.value !== v) out.push({ value: v, frame: f });
  }
  return out;
}

/**
 * The highlight landed on every word in order, none skipped and none extra,
 * each within a tenth of a second of when the audio starts it, both in the
 * bar's record and in the book's own highlight, up to where the audio got
 * to; and the paragraphs followed one another. `expected` is in reading
 * order; a word may not repeat the one before it (a repeat would not show as
 * a change, so the test could not see it).
 */
export function expectEveryWordOnTime(frames: Frame[], expected: Spoken[], opts: { minWords: number }) {
  expected.forEach((w, i) => expect(w.word, `word ${i} repeats the one before it; choose other paragraphs`).not.toBe(expected[i - 1]?.word));
  // How far the audio got in each file.
  const reached = new Map<number, number>();
  for (const f of frames) if (f[5] >= 0) reached.set(f[5], Math.max(reached.get(f[5]) ?? 0, f[0] * 1000));
  // Every word that started at least 120 ms before the audio got there must have been shown.
  const due = expected.filter((w) => w.startMs <= (reached.get(w.file) ?? -Infinity) - 120).length;
  for (const col of [1, 3] as const) {
    const seen = changes(frames, col);
    const name = col === 1 ? "bar" : "book highlight";
    expect(seen.length, `${name}: words shown`).toBeGreaterThanOrEqual(opts.minWords);
    expect(seen.length, `${name}: words shown, of ${due} due`).toBeGreaterThanOrEqual(due);
    expect(
      seen.map((s) => s.value),
      name,
    ).toEqual(expected.slice(0, seen.length).map((w) => w.word));
    seen.forEach((s, i) => {
      expect(s.frame[5], `${name}: "${s.value}" (word ${i}) shown while another file played`).toBe(expected[i].file);
      const late = s.frame[0] * 1000 - expected[i].startMs;
      expect(late, `${name}: "${s.value}" (word ${i}) shown ${Math.round(late)} ms after it starts`).toBeLessThan(100);
      expect(late, `${name}: "${s.value}" (word ${i}) shown before it starts`).toBeGreaterThanOrEqual(-1);
    });
  }
  // The bar moved through the paragraphs in order.
  const paragraphs = changes(frames, 2).map((s) => s.value);
  const order = [...new Set(expected.map((w) => w.cfi))];
  expect(paragraphs).toEqual(order.slice(0, paragraphs.length));
  return { paragraphs };
}
