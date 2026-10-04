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
