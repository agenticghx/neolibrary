import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M10 "Done when": a scripted reading session produces the expected
// words-per-minute number. The browser's clock is controlled (page.clock), so
// minutes pass in milliseconds. The Time Machine is opened by no other test.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

type Chapter = { key: string; label: string; position: number; activeSeconds: number; words: number };

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
  // M10 (c): the same sitting split by chapter adds up to the whole.
  const chapters = ((await (await page.request.get("/api/export")).json()).readingSessions as (Session & { chapters: Chapter[] })[]).find(
    (x) => x.bookId === bookId,
  )!.chapters;
  expect(chapters.length).toBeGreaterThanOrEqual(1);
  expect(chapters.every((c) => c.key && c.label)).toBe(true);
  expect(chapters.reduce((n, c) => n + c.words, 0)).toBe(s.words);
  expect(Math.abs(chapters.reduce((n, c) => n + c.activeSeconds, 0) - s.activeSeconds)).toBeLessThanOrEqual(chapters.length);

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
  // The timed save at 90 s is still on its way when the reader is left (held here, as a slow network
  // would hold it, then cut off by the leaving): the save on leaving must send the totals again, or
  // the sitting's last 30 s are lost (CI run 37437423658 recorded 60 of 90).
  let release = () => {};
  const left = new Promise<void>((resolve) => (release = resolve));
  let held = false;
  await page.route("**/api/books/*/reading", async (route) => {
    if (!held && (route.request().postDataJSON() as { activeSeconds: number }).activeSeconds >= 90) {
      held = true;
      await left;
      return route.abort().catch(() => undefined);
    }
    return route.continue().catch(() => undefined);
  });
  await page.clock.install({ time: new Date("2026-10-05T10:00:00Z") });
  await page.goto(`/books/${grid.id}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.clock.runFor(90_000);
  await expect.poll(() => held, { message: "the timed save at 90 s was sent (and held)" }).toBe(true);
  await page.goto("/stats"); // leaving the reader sends the sitting's totals
  release();
  await page.unroute("**/api/books/*/reading");

  type Session = { bookId: string; activeSeconds: number; words: number };
  const session = async () => ((await exported()).readingSessions as Session[]).find((s) => s.bookId === grid.id);
  await expect.poll(async () => (await session())?.activeSeconds ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(90);
  const g = (await session())!;
  const gridWpm = String(Math.round(g.words / (g.activeSeconds / 60)));

  await page.reload();
  // Both sittings fall in the week of 5 October (the browser's clock above): one row with both books' time.
  // Found by its date, not as the only row: the earlier projects read on the real date, which from
  // Monday 12 October 2026 is a later week with a row of its own (M21).
  const weeks = page.getByTestId("stats-weeks").locator("tbody tr");
  await expect(weeks.filter({ has: page.getByRole("rowheader", { name: "5 Oct", exact: true }) })).toHaveCount(1);
  await expect(weeks.first()).toHaveText(/^5 Oct/);
  await expect(weeks.first()).toContainText(/[45] min/);
  const pillar = page.getByTestId("stats-pillars").getByRole("row").filter({ hasText: "Electricity & the grid" });
  await expect(pillar).toContainText("Hidden Machinery");
  await expect(pillar).toContainText(gridWpm);
  // The Time Machine is on no Path, so the N group is The Grid alone.
  await expect(page.getByTestId("wpm-kind-N")).toHaveText(gridWpm);
  await expect(page.getByTestId("stats-kinds").getByRole("row")).toHaveCount(2); // header + N
  // Words true for every Path (this page mixes reading lists and your own Paths): sections, Story first, Go deeper.
  await expect(page.getByRole("heading", { level: 2, name: "By section", exact: true })).toBeVisible();
  await expect(page.getByTestId("stats-pillars").getByRole("columnheader").first()).toHaveText("Section");
  await expect(page.getByTestId("stats-kinds").getByRole("rowheader")).toHaveText(["Story first (N)"]);
  await expect(page.getByRole("heading", { level: 2, name: "By how to read it", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/pillar|narrative/i);
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

// M10 (c): a sitting whose chapter 4 went at well under the usual speed gives
// a suggestion naming that chapter. The sitting is sent the way the reader
// sends it (the first test checks the reader's own chapter split).
test("a chapter read much slower than usual gets a simple suggestion", async ({ page }) => {
  type Row = { id: string; title: string };
  const tm = ((await (await page.request.get("/api/export")).json()).books as Row[]).find((b) => b.title === "The Time Machine")!;
  const ch = (n: number, activeSeconds: number, words: number) => ({ key: `ch${n}.xhtml`, label: `Chapter ${n}`, position: n / 20, activeSeconds, words });
  const chapters = [ch(1, 180, 750), ch(2, 180, 750), ch(3, 180, 750), ch(4, 240, 400)];
  const sent = await page.request.post(`/api/books/${tm.id}/reading`, {
    data: { sessionId: crypto.randomUUID(), startedAt: new Date().toISOString(), activeSeconds: 780, words: 2650, pages: 10, chapters },
  });
  expect(sent.status()).toBe(204);
  await page.goto("/stats");
  const box = page.getByTestId("stats-suggestions");
  // (The first test's real sitting adds one more chapter of this book; the usual speed, the middle value, stays 250.)
  await expect(box.getByRole("listitem").filter({ hasText: "Chapter 4" })).toContainText(
    "In The Time Machine, your speed drops sharply in Chapter 4: 100 words per minute, against your usual 250 in this book.",
  );
  await expect(box.getByRole("link", { name: "The Time Machine" })).toHaveAttribute("href", `/books/${tm.id}/read`);
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(box).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await box.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `screenshots/stats-suggestion-${name}-${scheme}.png` });
    }
  }
});

// M21: the reading calendar and streaks. The server's clock is the real one, so sittings are sent (the way the
// reader sends them) on days counted back from today in UTC: a run of three days up to today (the sitting above
// is today's), half a minute three days ago (under a minute: it breaks the run), two more days, and a best day.
// The expected numbers are worked out from your exported sittings, so the earlier tests' reading counts too.
test("the reading calendar shades each day, says its minutes, and counts your streaks", async ({ page }) => {
  type Row = { id: string; title: string };
  type Sitting = { startedAt: string; activeSeconds: number };
  const exported = async () => (await page.request.get("/api/export")).json();
  const tm = ((await exported()).books as Row[]).find((b) => b.title === "The Time Machine")!;
  const DAY = 86_400_000;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const key = (daysAgo: number) => new Date(today - daysAgo * DAY).toISOString().slice(0, 10);
  const seeds: [daysAgo: number, seconds: number][] = [[1, 20 * 60], [2, 7 * 60], [3, 30], [5, 45 * 60], [6, 16 * 60], [10, 95 * 60]];
  for (const [daysAgo, seconds] of seeds) {
    const sent = await page.request.post(`/api/books/${tm.id}/reading`, {
      data: { sessionId: crypto.randomUUID(), startedAt: `${key(daysAgo)}T12:00:00.000Z`, activeSeconds: seconds, words: seconds * 4, pages: 3 },
    });
    expect(sent.status()).toBe(204);
  }

  // What the page should say, from every stored sitting: seconds per UTC day, a day read from a full minute.
  const byDay = new Map<string, number>();
  for (const s of (await exported()).readingSessions as Sitting[]) byDay.set(s.startedAt.slice(0, 10), (byDay.get(s.startedAt.slice(0, 10)) ?? 0) + s.activeSeconds);
  const seconds = (daysAgo: number) => byDay.get(key(daysAgo)) ?? 0;
  const isRead = (d: string) => (byDay.get(d) ?? 0) >= 60;
  let current = 0;
  for (let n = isRead(key(0)) ? 0 : 1; isRead(key(n)); n++) current++;
  const readDays = [...byDay.keys()].filter(isRead).map((d) => Date.parse(`${d}T00:00:00Z`) / DAY);
  const longest = Math.max(...readDays.map((d) => { let n = 0; while (readDays.includes(d - n)) n++; return n; }));
  const [bestDay, bestSeconds] = [...byDay].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))[0];
  const monday = today - ((now.getUTCDay() + 6) % 7) * DAY;
  const firstShown = monday - 25 * 7 * DAY;
  const daysRead = readDays.filter((d) => d * DAY >= firstShown && d * DAY <= today).length;
  expect(current, "today and the two days before were read").toBeGreaterThanOrEqual(3);
  expect(bestSeconds).toBeGreaterThanOrEqual(95 * 60);

  const label = (daysAgo: number) => {
    const s = seconds(daysAgo);
    const m = Math.floor(s / 60);
    const minutes = s === 0 ? "no reading" : m === 0 ? "under a minute" : m === 1 ? "1 minute" : `${m} minutes`;
    const name = new Date(today - daysAgo * DAY).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    return `${name}${daysAgo === 0 ? ", today" : ""}: ${minutes}`;
  };
  const step = (daysAgo: number) => [1, 15, 30, 60].filter((m) => Math.floor(seconds(daysAgo) / 60) >= m).length;
  const time = (s: number) => { const m = Math.floor(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

  await page.goto("/stats");
  const calendar = page.getByTestId("stats-calendar");
  await expect(calendar.getByRole("heading", { level: 2, name: "Reading calendar" })).toBeVisible();
  const grid = calendar.getByRole("table", { name: /Minutes read each day for the last 26 weeks/ });
  // 25 full weeks and this week up to today; the days still to come have no square.
  await expect(grid.locator("td[data-step]")).toHaveCount(25 * 7 + ((now.getUTCDay() + 6) % 7) + 1);
  for (let daysAgo = 0; daysAgo <= 11; daysAgo++) {
    const cell = grid.getByRole("cell", { name: label(daysAgo), exact: true });
    await expect(cell, label(daysAgo)).toHaveCount(1);
    await expect(cell).toHaveAttribute("data-step", String(step(daysAgo)));
  }
  // Rows are weekdays, columns weeks, each with a header screen readers announce.
  await expect(grid.getByRole("rowheader")).toHaveText(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => new RegExp(`^${d}`)));
  await expect(grid.getByRole("columnheader")).toHaveCount(26);
  await expect(grid.getByRole("columnheader").last()).toContainText(`Week of ${new Date(monday).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}`);

  const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);
  await expect(page.getByTestId("streak-current")).toHaveText(days(current));
  await expect(page.getByTestId("streak-longest")).toHaveText(days(longest));
  await expect(page.getByTestId("streak-best")).toHaveText(time(bestSeconds));
  await expect(page.getByTestId("streak-best-date")).toHaveText(
    new Date(`${bestDay}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
  );
  await expect(page.getByTestId("streak-days")).toHaveText(String(daysRead));
  await expect(calendar.getByRole("definition").filter({ has: page.getByTestId("streak-current") })).toContainText(isRead(key(0)) ? "Including today" : "Read today to keep it going");

  const legend = page.getByTestId("calendar-legend");
  await expect(legend).toContainText("Less");
  await expect(legend).toContainText("More");
  await expect(legend.getByRole("list", { name: "Shades, from less reading to more" }).getByRole("listitem")).toHaveText([
    "No reading",
    "1 to 14 minutes",
    "15 to 29 minutes",
    "30 to 59 minutes",
    "60 minutes or more",
  ]);

  // Never wider than the screen; if the calendar scrolls, it starts at today, at its right end.
  const region = calendar.getByRole("region", { name: "Reading calendar, the last 26 weeks" });
  const todayInView = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = (await region.boundingBox())!;
    const todayBox = (await grid.getByRole("cell", { name: label(0), exact: true }).boundingBox())!;
    expect(todayBox.x).toBeGreaterThanOrEqual(box.x);
    expect(todayBox.x + todayBox.width).toBeLessThanOrEqual(box.x + box.width);
  };

  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(calendar).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await todayInView();
      await calendar.scrollIntoViewIfNeeded();
      await calendar.screenshot({ path: `screenshots/stats-calendar-${name}-${scheme}.png` });
    }
  }

  // A small phone (320 px wide) cannot hold all 26 weeks: the calendar scrolls inside its own box and opens at today,
  // with the oldest weeks out of view on the left.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(calendar).toBeVisible();
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth), "the calendar scrolls at 320 px").toBe(true);
  await todayInView();
  expect((await grid.locator("td[data-step]").first().boundingBox())!.x).toBeLessThan((await region.boundingBox())!.x);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  await calendar.scrollIntoViewIfNeeded();
  await calendar.screenshot({ path: "screenshots/stats-calendar-narrow-light.png" });
});
