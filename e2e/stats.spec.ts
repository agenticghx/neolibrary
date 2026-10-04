import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M10 "Done when": a scripted reading session produces the expected
// words-per-minute number. The browser's clock is controlled (page.clock), so
// minutes pass in milliseconds. The Time Machine is opened by no other test.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

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

// M10 (b) "your own trend first": The Grid (uploaded in uploads.spec.ts) is the
// N book of the "Electricity & the grid" pillar on the Hidden Machinery path,
// so a minute with it fills the pillar and N/E sections of /stats.
test("the stats page shows your trend by week, by pillar and N vs E, then a cited average", async ({ page }) => {
  type Row = { id: string; title: string };
  const exported = async () => (await page.request.get("/api/export")).json();
  const grid = ((await exported()).books as Row[]).find((b) => b.title.startsWith("The Grid"))!;
  await page.clock.install({ time: new Date("2026-10-05T10:00:00Z") });
  await page.goto(`/books/${grid.id}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.clock.runFor(90_000);
  await page.goto("/stats"); // leaving the reader sends the sitting's totals

  type Session = { bookId: string; activeSeconds: number; words: number };
  const session = async () => ((await exported()).readingSessions as Session[]).find((s) => s.bookId === grid.id);
  await expect.poll(async () => (await session())?.activeSeconds ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(90);
  const g = (await session())!;
  const gridWpm = String(Math.round(g.words / (g.activeSeconds / 60)));

  await page.reload();
  // Both sittings fall in the current week: one row with both books' time.
  const weeks = page.getByTestId("stats-weeks").locator("tbody tr");
  await expect(weeks).toHaveCount(1);
  await expect(weeks.first()).toContainText(/[45] min/);
  const pillar = page.getByTestId("stats-pillars").getByRole("row").filter({ hasText: "Electricity & the grid" });
  await expect(pillar).toContainText("Hidden Machinery");
  await expect(pillar).toContainText(gridWpm);
  // The Time Machine is on no Path, so the N group is The Grid alone.
  await expect(page.getByTestId("wpm-kind-N")).toHaveText(gridWpm);
  await expect(page.getByTestId("stats-kinds").getByRole("row")).toHaveCount(2); // header + N
  const compare = page.getByTestId("stats-compare");
  await expect(compare).toContainText("238 words per minute for non-fiction");
  await expect(compare).toContainText("260 for fiction");
  await expect(compare.getByRole("link", { name: "doi:10.1016/j.jml.2019.104047" })).toHaveAttribute("href", "https://doi.org/10.1016/j.jml.2019.104047");

  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload(); // fresh colours, no theme transition half-way
      await expect(page.getByTestId("stats-compare")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/stats-trend-${name}-${scheme}.png`, fullPage: true });
    }
  }
});
