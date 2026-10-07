import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
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
const findBook = async (page: Page, start: string) =>
  ((await (await page.request.get("/api/export")).json()).books as ExportedBook[]).find((b) => b.title.startsWith(start))!;
const jekyll = (page: Page) => findBook(page, "The Strange Case");
const cfiStart = (cfi: string | null) => (cfi ?? "").split(",")[0];

test("Continue shows the book opened last, its newest note, Read from here and Listen from here", async ({ page }) => {
  const book = await jekyll(page);
  const pdf = await findBook(page, "Discourse on the Method"); // a PDF: Read only, no audiobook
  expect(book.position, "the reader tests left a saved place in Jekyll").toBeTruthy();
  // Open the PDF, then Jekyll, last (saving their places again, unchanged), and leave a note in Jekyll.
  expect((await page.request.put(`/api/books/${pdf.id}/position`, { data: { cfi: pdf.position ?? "epubcfi(/6/2)", fraction: pdf.progress } })).status()).toBe(204);
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
  // The PDF's card: no Listen from here (nothing to listen to), and no note box (no notes in it).
  const second = cards.nth(1);
  await expect(second.getByRole("heading", { level: 3 })).toHaveText(pdf.title);
  await expect(second.getByRole("link", { name: "Read from here" })).toBeVisible();
  await expect(second.getByRole("link", { name: "Listen from here" })).toHaveCount(0);
  await expect(second.getByText(/^Your last (note|highlight) here$/)).toHaveCount(0);

  // Read from here: the reader at the saved place.
  await card.getByRole("link", { name: "Read from here" }).click();
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  expect(cfiStart(await reader.getAttribute("data-cfi"))).toBe(cfiStart(book.position!));
  await expect(page.getByRole("region", { name: "Read aloud" })).toHaveCount(0);

  // Listen from here: the reader with the Read aloud bar open (the reader presses Play: Safari needs the click).
  await page.goto("/");
  await expect(card.getByRole("link", { name: "Listen from here" })).toHaveAttribute("href", `/books/${book.id}/read?listen=1`);
  await card.getByRole("link", { name: "Listen from here" }).click();
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Read aloud" })).toBeVisible({ timeout: 10_000 });
  // Used once: ?listen=1 leaves the address, so a reload does not open the bar again.
  await expect(page).toHaveURL(new RegExp(`/books/${book.id}/read$`));

  // A book with nothing to listen to never opens the bar, even when asked.
  await page.goto(`/books/${pdf.id}/read?listen=1`);
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Read aloud" })).toHaveCount(0);
});

test("the library: labels, marks, the closed group of titles not available yet, and Import", async ({ page }) => {
  const book = await jekyll(page);
  await page.goto("/");
  const grid = page.getByTestId("shelf");
  const item = grid.getByRole("listitem").filter({ hasText: book.title });
  await expect(item.getByText("Read and listen", { exact: true })).toBeVisible(); // an EPUB, narration on in tests
  await expect(item.locator('[data-mark="notes"]')).toHaveCount(1); // it has notes: the folded corner
  await expect(item.locator('[data-mark="audiobook"]')).toHaveCount(0); // narration alone draws no headphones (D1)
  await expect(item).toContainText("has your notes"); // the marks in words, for screen readers
  const finished = grid.getByRole("listitem").filter({ hasText: "Trap Book" });
  await expect(finished.locator('[data-mark="finished"]')).toHaveCount(1);
  await expect(finished).toContainText("Finished");
  // The count is of the grid's titles (the ones not available yet are counted in their own group).
  const count = Number((await page.getByRole("heading", { name: /^Your library \d+ titles$/ }).textContent())!.match(/(\d+) titles/)![1]);
  await expect(grid.locator(":scope > li")).toHaveCount(count);
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

  // Import is one place now (Samuel, #90): Home has no drop strip, and its Import goes to the Import page.
  await expect(page.getByText(/^Drop your DRM-free books/)).toHaveCount(0);
  // Under the mouse, its word and icon stay readable: the links' own hover colour is the button's hover background.
  const importLink = page.getByRole("link", { name: "Import", exact: true });
  await importLink.hover();
  const hovered = await importLink.evaluate(async (el) => {
    await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)); // the colour change runs to its end
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
  expect(hovered.color).not.toBe(hovered.background);
  await importLink.click();
  await expect(page).toHaveURL(/\/import$/);
  // There, files are read like the library's: a book already here, and a file that is not a book.
  await expect(page.getByLabel("Choose files")).toHaveAttribute("multiple", "");
  await page.getByLabel("Choose files").setInputFiles([
    { name: "wells-the-time-machine.epub", mimeType: "application/epub+zip", buffer: readFileSync("fixtures/books/wells-the-time-machine.epub") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
  ]);
  const results = page.getByTestId("upload-results");
  await expect(results.getByText("Already in your library")).toBeVisible();
  await expect(results.getByText("Only EPUB and PDF files can be added.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "2 files read." })).toBeAttached();

  // A file dropped anywhere on the Import page, even on the sidebar, is sent, not opened by the browser.
  await page.reload();
  const transfer = await page.evaluateHandle(() => {
    const t = new DataTransfer();
    t.items.add(new File(["hello"], "dropped.txt", { type: "text/plain" }));
    return t;
  });
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  for (const type of ["dragenter", "dragover", "drop"]) await sidebar.dispatchEvent(type, { dataTransfer: transfer });
  await expect(page.getByTestId("upload-results").getByText("Only EPUB and PDF files can be added.")).toBeVisible();
  await expect(page).toHaveURL(/\/import$/);
  await page.goto("/");

  // Sort by title: the grid's first title comes first in the alphabet.
  await page.getByLabel("Sort").selectOption("title");
  await expect(page).toHaveURL(/\?sort=title$/);
  const titles = await grid.locator(":scope > li [class*=itemTitle]").allTextContents();
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
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
      await expect(page.getByTestId("continue-card")).toHaveCount(2); // both drawn ...
      await expect(page.getByTestId("continue-card").first()).toBeVisible();
      await expect(page.getByTestId("continue-card").nth(1)).toBeHidden(); // ... one shown on a phone (D7)
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
    // A finished book's spine says Done at its foot; a spine's name says how far you are.
    await expect(spines.getByRole("link", { name: /^Trap Book, finished/ })).toContainText("Done");
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

test("/library has the same View switch", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "Spines", exact: true }).click();
  await expect(page.getByTestId("spines")).toBeVisible();
  await expect(page.getByTestId("shelf")).toBeHidden();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.getByTestId("shelf")).toBeVisible();
  // The whole library ends with the titles not available yet, as on Home.
  await expect(page.getByText(/^Not available yet \(\d+\)$/)).toBeVisible();
});

// M14 step 4 "Done when": every filter shows exactly its titles (D5), worked out here from the
// library's own export, so the test holds whatever the earlier projects added.
test("each library filter shows exactly its titles, with the right count", async ({ page }) => {
  type B = { id: string; title: string; file: { type: "epub" | "pdf" | null } | null; progress: number; lastOpenedAt: string | null };
  type Imp = { bookId: string; status: string };
  const data = (await (await page.request.get("/api/export")).json()) as { books: B[]; readalongImports?: Imp[] };
  const withFile = data.books.filter((b) => b.file);
  const titleOnly = data.books.filter((b) => !b.file);
  const audio = new Set((data.readalongImports ?? []).filter((i) => i.status === "ready").map((i) => i.bookId));
  const expected: Record<string, { grid: B[]; waiting: number; heading: string }> = {
    want: { grid: withFile.filter((b) => b.progress === 0 && !b.lastOpenedAt), waiting: titleOnly.length, heading: "Want to Read" },
    finished: { grid: withFile.filter((b) => b.progress >= 1), waiting: 0, heading: "Finished" },
    books: { grid: withFile.filter((b) => b.file!.type === "epub"), waiting: 0, heading: "Books" },
    pdfs: { grid: withFile.filter((b) => b.file!.type === "pdf"), waiting: 0, heading: "PDFs" },
    audiobooks: { grid: withFile.filter((b) => audio.has(b.id)), waiting: 0, heading: "Audiobooks" },
  };
  expect(expected.finished.grid.length, "a finished book exists by now (Trap Book)").toBeGreaterThan(0);
  expect(expected.pdfs.grid.length, "a PDF exists by now (Discourse on the Method)").toBeGreaterThan(0);
  for (const [show, want] of Object.entries(expected)) {
    await page.goto(`/library?show=${show}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(want.heading);
    const titles = await page.getByTestId("shelf").locator(":scope > li [class*=itemTitle]").allTextContents();
    expect(titles.sort(), show).toEqual(want.grid.map((b) => b.title).sort());
    const n = want.grid.length;
    const line = `${n} ${n === 1 ? "title" : "titles"}${want.waiting ? `, and ${want.waiting} not available yet` : ""}.`;
    await expect(page.getByText(line, { exact: true })).toBeVisible();
    await expect(page.getByText(/^Not available yet \(\d+\)$/)).toHaveCount(want.waiting ? 1 : 0);
  }
  // On a phone, the Library tab offers the same filters as chips.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");
  const chips = page.getByRole("navigation", { name: "Filters" });
  await expect(chips.getByRole("link")).toHaveText(["All", "Want to Read", "Finished", "Books", "Audiobooks", "PDFs"]);
  await chips.getByRole("link", { name: "PDFs" }).click();
  await expect(page).toHaveURL(/\/library\?show=pdfs$/);
  await expect(chips.getByRole("link", { name: "PDFs" })).toHaveAttribute("aria-current", "page");
});

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

      // The spine view and the opened group of titles not available yet, too.
      await page.getByRole("button", { name: "Spines", exact: true }).click();
      await page.locator("details summary").filter({ hasText: /^Not available yet/ }).click();
      const more = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(more.violations.map((v) => `${name} ${scheme} spines ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/home-spines-${name}-${scheme}.png`, fullPage: true });
      await page.getByRole("button", { name: "Grid", exact: true }).click();
    }
  }
});
