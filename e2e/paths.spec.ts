import { expect, test } from "@playwright/test";
import { hiddenMachinery } from "../data/paths/hidden-machinery";
import { ADMIN_STATE } from "./pages";

// M3 "Done when" (part): the Hidden Machinery Path shows every pillar in the
// reading list, with N before E and the master key last.

test.use({ storageState: ADMIN_STATE });

test("the owner's library opens on the Hidden Machinery path, in reading order", async ({ page }) => {
  await page.goto("/paths/hidden-machinery");
  await expect(page.getByRole("heading", { name: "Hidden Machinery", level: 1 })).toBeVisible();
  // A reading list keeps its own words (a Path you make says "sections" instead: own-paths.spec.ts).
  await expect(page.getByText(/^\d+ pillars · Read N, then E · /)).toBeVisible();
  await expect(page.getByRole("list", { name: /^\d+ of \d+ pillars finished$/ })).toBeVisible();

  const pillarTitles = await page.getByTestId("pillar").locator("h3").allTextContents();
  const expected = hiddenMachinery.pillars.filter((p) => p.group !== "master").map((p) => p.title);
  expect(pillarTitles).toEqual(expected);

  // The letters are read out as the reading list's own words.
  const first = page.getByTestId("pillar").first();
  await expect(first.getByText("Narrative, read first", { exact: true })).toHaveCount(1);
  await expect(first.getByText("Engineering, read second", { exact: true })).toHaveCount(1);
  await expect(first.locator("ol li > span:first-child").first()).toHaveAttribute("aria-hidden", "true");

  // N before E inside every pillar that has both.
  for (const pillar of await page.getByTestId("pillar").all()) {
    const kinds = await pillar.locator("ol li > span:first-child").allTextContents();
    if (kinds.length === 2) expect(kinds).toEqual(["N", "E"]);
  }

  // The master key comes after every pillar.
  const master = page.getByRole("heading", { name: "Master key" });
  await expect(master).toBeVisible();
  const lastPillarBox = await page.getByTestId("pillar").last().boundingBox();
  const masterBox = await master.boundingBox();
  expect(masterBox!.y).toBeGreaterThan(lastPillarBox!.y);
  await expect(page.getByRole("link", { name: "Seeing Like a State (not available yet)" })).toBeVisible();

  // Its groups, in order, and the extras folded under each pair (a Path you make shows every title instead).
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([
    "The eighteen systems",
    "Money and credit",
    "Blindspots",
    "Suggested additions",
    "Master key",
  ]);
  const bankingExtras = hiddenMachinery.pillars.find((p) => p.slug === "banking")!.books.filter((b) => b.kind === "extra").length;
  const banking = page.getByTestId("pillar").filter({ has: page.getByRole("heading", { level: 3, name: "Banking & credit" }) });
  await expect(banking.locator("summary").filter({ hasText: /more books?$/ })).toHaveText(`${bankingExtras} more books`);

  // No book file yet: titles are greyed and labelled, and "you are here" is on pillar 01.
  await expect(page.getByText("Not available yet", { exact: true }).first()).toBeVisible();
  const here = page.getByText("You are here");
  await expect(here).toHaveCount(1);
  await expect(page.getByTestId("pillar").filter({ has: here }).locator("h3")).toHaveText("Electricity & the grid");
});

test("a title not available yet has its own page saying where it sits", async ({ page }) => {
  await page.goto("/paths/hidden-machinery");
  await page.getByRole("link", { name: "Chip War (not available yet)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chip War", level: 1 })).toBeVisible();
  await expect(page.getByText("Hidden Machinery › Semiconductors · narrative, read first")).toBeVisible();
  await expect(page.getByText("Not available yet. Add the book file (EPUB or PDF) and it attaches here.")).toBeVisible();
});

test("a reading list cannot be edited: no Edit path, and its edit page is not found", async ({ page }) => {
  await page.goto("/paths/hidden-machinery");
  await expect(page.getByRole("heading", { name: "Hidden Machinery", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit path", exact: true })).toHaveCount(0);
  expect((await page.request.get("/paths/hidden-machinery/edit")).status()).toBe(404);
  expect((await page.request.get("/paths/not-a-path/edit")).status()).toBe(404);
});

test("agent suggestions are labelled as not catalog-checked", async ({ page }) => {
  await page.goto("/paths/hidden-machinery");
  const geo = page.getByTestId("pillar").filter({ has: page.getByRole("heading", { name: "Geospatial reasoning" }) });
  await expect(geo.getByText("Agent suggestions, not catalog-checked")).toBeVisible();
  await geo.getByRole("link", { name: "The Power of Maps (not available yet)" }).click();
  await expect(page.getByText("not checked against a catalog")).toBeVisible();
});

test("a book id that is not yours (or not real) is a 404", async ({ page }) => {
  expect((await page.goto("/books/00000000-0000-0000-0000-000000000000"))?.status()).toBe(404);
  expect((await page.goto("/books/not-a-uuid"))?.status()).toBe(404);
  expect((await page.goto(`/books/${"-".repeat(36)}`))?.status()).toBe(404); // 36 characters that are not an id
});
