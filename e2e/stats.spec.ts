import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M10 "Done when": a scripted reading session produces the expected
// words-per-minute number. The browser's clock is controlled (page.clock), so
// minutes pass in milliseconds. The Time Machine is opened by no other test.

test.use({ storageState: ADMIN_STATE });

/** Words on the page the reader is showing, counted the same way as the app (collapsed whitespace). */
const pageWords = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { lastLocation: { range: Range } | null };
    const text = (view.lastLocation?.range.toString() ?? "").replace(/\s+/g, " ").trim();
    return (text.match(/\S+/g) ?? []).length;
  });

test("a scripted reading session gives the expected words per minute; idle time does not count", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-05T09:00:00Z") });
  await page.goto(`/search?q=${encodeURIComponent('"recondite matter"')}`);
  await page.getByRole("region", { name: /The Time Machine/ }).getByRole("link").first().click();
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const bookId = /\/books\/([0-9a-f-]{36})\/read/.exec(page.url())![1];
  const first = await pageWords(page);
  expect(first).toBeGreaterThan(50);

  // One minute on the first page.
  await page.clock.runFor(60_000);
  // Turn the page (activity), one minute on the second page.
  const cfi = await reader.getAttribute("data-cfi");
  await page.keyboard.press("ArrowRight");
  await expect(reader).not.toHaveAttribute("data-cfi", cfi ?? "");
  const second = await pageWords(page);
  expect(second).toBeGreaterThan(50);
  await page.clock.runFor(60_000);
  // Then five minutes with no input: only the first two of them count (the idle limit).
  await page.clock.runFor(300_000);

  type Session = { bookId: string; activeSeconds: number; words: number; pages: number };
  const session = async () =>
    ((await (await page.request.get("/api/export")).json()).readingSessions as Session[]).find((s) => s.bookId === bookId);
  await expect.poll(async () => (await session())?.activeSeconds ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(180);
  const s = (await session())!;
  // 60 s + 60 s + 60 s before the idle limit; a second or two more is page loading.
  expect(s.activeSeconds).toBeLessThanOrEqual(183);
  expect(s.pages).toBe(2);
  expect(s.words).toBe(first + second);

  await page.goto("/stats");
  const row = page.getByTestId("stats-books").getByRole("row").filter({ hasText: "The Time Machine" });
  await expect(row).toContainText("3 min");
  await expect(page.getByTestId(`wpm-${bookId}`)).toHaveText(String(Math.round(s.words / (s.activeSeconds / 60))));
});
