import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M14 step 3 "Done when": after sign-in Home shows Continue with the book
// opened last, its newest note and both buttons, then the whole library with
// Import; the View switch works on desktop and phone. Runs after the stats
// project: Jekyll has a saved place and notes from the reader, annotations
// and other projects; The Grid and The Time Machine were opened by stats.

test.use({ storageState: ADMIN_STATE });

// In order, one at a time: the first test sets which book was opened last.
test.describe.configure({ mode: "default" });

type ExportedBook = { id: string; title: string; position?: string | null; progress: number };
const jekyll = async (page: Page) =>
  ((await (await page.request.get("/api/export")).json()).books as ExportedBook[]).find((b) => b.title.startsWith("The Strange Case"))!;

test("Continue shows the book opened last, its newest note, Read from here and Listen from here", async ({ page }) => {
  const book = await jekyll(page);
  expect(book.position, "the reader tests left a saved place in Jekyll").toBeTruthy();
  // Open it last (saving its place again, unchanged) and leave a note: both now the newest.
  expect((await page.request.put(`/api/books/${book.id}/position`, { data: { cfi: book.position, fraction: book.progress } })).status()).toBe(204);
  expect((await page.request.post(`/api/books/${book.id}/annotations`, { data: { kind: "note", body: "A thought left for Home." } })).status()).toBe(201);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  const cards = page.getByTestId("continue-card");
  await expect(cards).toHaveCount(2); // two on desktop (D7)
  const card = cards.first();
  await expect(card.getByRole("heading", { level: 3 })).toHaveText(book.title);
  await expect(card).toContainText(`${Math.round(book.progress * 100)}%`);
  await expect(card).toContainText("Your last note here");
  await expect(card).toContainText("A thought left for Home.");

  // Read from here: the reader at the saved place.
  await card.getByRole("link", { name: "Read from here" }).click();
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const spineOf = (cfi: string | null) => (cfi ?? "").split("!")[0];
  expect(spineOf(await reader.getAttribute("data-cfi"))).toBe(spineOf(book.position!));
  await expect(page.getByRole("region", { name: "Read aloud" })).toHaveCount(0);

  // Listen from here: the reader with the Read aloud bar open (the reader presses Play: Safari needs the click).
  await page.goto("/");
  await expect(card.getByRole("link", { name: "Listen from here" })).toHaveAttribute("href", `/books/${book.id}/read?listen=1`);
  await card.getByRole("link", { name: "Listen from here" }).click();
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Read aloud" })).toBeVisible({ timeout: 10_000 });
});

test("the library: labels, marks, the closed group of titles not available yet, and Import", async ({ page }) => {
  const book = await jekyll(page);
  await page.goto("/");
  const grid = page.getByTestId("shelf");
  const item = grid.getByRole("listitem").filter({ hasText: book.title });
  await expect(item.getByText("Read and listen", { exact: true })).toBeVisible(); // an EPUB, narration on in tests
  await expect(item.locator('[data-mark="notes"]')).toHaveCount(1); // it has notes: the folded corner
  await expect(page.getByRole("heading", { name: /^Your library \d+ titles$/ })).toBeVisible();
  // Every cover fits its grid cell (a long title once drew a cover two cells wide, over its neighbour).
  const overflow = await grid.locator(":scope > li").evaluateAll((items) =>
    items.flatMap((li) => {
      const cover = li.querySelector("figure")!.getBoundingClientRect();
      const cell = li.getBoundingClientRect();
      return cover.width > cell.width + 0.5 ? [`${li.textContent?.slice(0, 30)}: ${Math.round(cover.width)} > ${Math.round(cell.width)}`] : [];
    }),
  );
  expect(overflow).toEqual([]);

  // Hidden Machinery's titles wait in one closed group, not in the grid.
  const group = page.locator("details").filter({ has: page.getByText(/^Not available yet \(\d+\)$/) });
  await expect(group).not.toHaveAttribute("open");
  await expect(grid.getByRole("link", { name: /^Chip War/ })).toHaveCount(0);
  await group.locator("summary").click();
  const waiting = group.getByRole("link", { name: /^Chip War/ });
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText("Not available yet");
  await expect(waiting.locator("img")).toHaveCount(0); // a greyed cover, no picture

  // Import opens the file picker; Choose files is there too.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import" }).click();
  expect((await chooser).isMultiple()).toBe(true);
  await expect(page.getByLabel("Choose files")).toBeAttached();
});

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`the View switch shows grid or spines and is remembered (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const grid = page.getByTestId("shelf");
    const spines = page.getByTestId("spines");
    const gridButton = page.getByRole("button", { name: "Grid", exact: true });
    const spinesButton = page.getByRole("button", { name: "Spines", exact: true });
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");
    await expect(grid).toBeVisible();
    await expect(spines).toBeHidden();
    if (name === "phone") {
      await expect(page.getByTestId("continue-card").first()).toBeVisible();
      await expect(page.getByTestId("continue-card").nth(1)).toBeHidden(); // one card on a phone (D7)
    }

    await spinesButton.click();
    await expect(spinesButton).toHaveAttribute("aria-pressed", "true");
    await expect(spines).toBeVisible();
    await expect(grid).toBeHidden();
    // Each spine is a link named by its title and progress; the hidden grid is not in the
    // accessibility tree, so the book has one link (Continue's title is a heading, not a link).
    const book = await jekyll(page);
    await expect(page.getByRole("link", { name: `${book.title}, ${Math.round(book.progress * 100)}% read` })).toHaveCount(1);
    await expect(page.getByRole("link", { name: new RegExp(`^${book.title.slice(0, 20)}`) })).toHaveCount(1);
    await page.reload();
    await expect(spinesButton).toHaveAttribute("aria-pressed", "true");
    await expect(spines).toBeVisible();
    await expect(grid).toBeHidden();

    await gridButton.click();
    await page.reload();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");
    await expect(grid).toBeVisible();
  });
}

test("Home is accessible, fits a phone, and looks right in light and dark", async ({ page }) => {
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/"); // fresh colours, no theme transition half-way
      await expect(page.getByTestId("continue-card").first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${name} ${scheme} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/home-full-${name}-${scheme}.png`, fullPage: true });
    }
  }
});
