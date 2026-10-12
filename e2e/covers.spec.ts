import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M22 "Done when": with the fake catalogue (two covers for every title, none for "Oil 101"), a reader of its own
// adds Hidden Machinery, presses Find covers now, sees the covers found and the titles without one, turns a cover
// down (the next match takes its place) and down again (the drawn cover comes back), and sees a found cover greyed
// on a title not available yet, in the Library and on the title's page. A reader of its own (invited here), so the
// projects that run beside this one (home, review) see no covers: the automatic lookup is off in these tests
// (COVER_LOOKUP=off), and this test asks for its reader's titles only.
// C3a "Done when": the reader gives Oil 101 a cover from their own search ("Choose a cover"), replaces it with
// "Choose another", and sees the dialog in four looks.

const axe = async (page: Page, look: string) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${look} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
};

const picturesLoaded = (page: Page) => page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));

/** A page in the four looks: accessible, no sideways scroll on a phone, a screenshot for the PR's grid (as review.spec.ts). */
async function fourLooks(page: Page, name: string, ready: () => Promise<void>) {
  await mkdir("screenshots", { recursive: true });
  for (const [size, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await ready();
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.fonts.ready);
      await axe(page, `${size} ${scheme}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/${name}-${size}-${scheme}.png`, fullPage: false });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
}

/** The owner invites a new reader, who joins; returns the reader's page (signed in, on Home). */
async function newReader(page: Page, browser: Browser) {
  await page.goto("/admin/invites");
  await page.getByLabel(/Who is it for/).fill("Cora, covers");
  await page.getByRole("button", { name: "Make an invitation link" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 800 } });
  const reader = await ctx.newPage();
  await reader.goto(link);
  await reader.getByLabel("Your name").fill("Cora Covers");
  await reader.getByLabel("Email address").fill(`covers-${Date.now()}@example.com`);
  await reader.getByLabel("Password").fill("covers from catalogues");
  await reader.getByRole("button", { name: "Join the library" }).click();
  await expect(reader.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  return reader;
}

test.use({ storageState: ADMIN_STATE });

test("Covers: Find covers now, a cover turned down for the next and then for good, and found covers greyed on titles not available yet", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const reader = await newReader(page, browser);
  await reader.goto("/paths");
  await reader.getByRole("button", { name: "Add this path" }).click();
  await expect(reader).toHaveURL(/\/paths\/hidden-machinery$/);

  await reader.goto("/covers");
  await expect(reader.getByRole("heading", { name: "Covers", level: 1 })).toBeVisible();
  await expect(reader.getByRole("heading", { name: "Found (0)" })).toBeVisible();
  await expect(reader.getByTestId("no-cover")).toContainText("The Grid");

  await reader.getByRole("button", { name: "Find covers now" }).click();
  await expect(reader.getByTestId("find-status")).toContainText("Done.", { timeout: 120_000 });
  const found = reader.getByTestId("found-covers").getByRole("listitem");
  await expect.poll(() => found.count()).toBeGreaterThan(90);
  // The fake catalogue has nothing for Oil 101: it keeps its drawn cover, listed with the titles without one.
  await expect(reader.getByTestId("no-cover").getByRole("listitem")).toHaveText([/^Oil 101/]);
  await expect(reader.getByRole("heading", { name: `Found (${await found.count()})` })).toBeVisible();

  // Each picture is the reader's own stored copy, with where it came from.
  const grid = reader.locator('[data-testid="found-covers"] li[data-title="The Grid"]');
  const picture = grid.getByRole("img", { name: "Cover found for The Grid" });
  await expect.poll(() => picture.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120);
  expect(await picture.getAttribute("src")).toMatch(/^\/api\/files\/covers\//);
  await expect(grid.getByRole("link", { name: "From the test catalogue" })).toHaveAttribute("href", "https://catalogue.example.org/fake/the-grid");
  const first = (await picture.getAttribute("src"))!.split("?")[0];

  // Not this cover: the next match takes its place.
  await grid.getByRole("button", { name: "Not this cover: The Grid" }).click();
  await expect(reader.getByTestId("reject-status")).toHaveText("“The Grid”: cover turned down; the next match is shown.");
  await expect.poll(async () => (await picture.getAttribute("src"))?.split("?")[0]).not.toBe(first);
  await expect.poll(() => picture.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120);
  // Again: no other match, so the drawn cover comes back, and the title joins the ones without a cover, for good.
  await grid.getByRole("button", { name: "Not this cover: The Grid" }).click();
  await expect(reader.getByTestId("reject-status")).toContainText("“The Grid”: cover turned down; no other was found");
  await expect(grid).toHaveCount(0);
  await expect(reader.getByTestId("no-cover")).toContainText("The Grid");
  await reader.getByRole("button", { name: "Find covers now" }).click();
  await expect(reader.getByTestId("find-status")).toContainText("; 2 without one.", { timeout: 60_000 });
  await expect(reader.getByTestId("no-cover")).toContainText("The Grid");

  // Choose a cover (C3a): the fake catalogue has no match for Oil 101, so the reader searches and picks one.
  await reader.getByRole("button", { name: "Choose a cover: Oil 101" }).click();
  const chooser = reader.getByRole("dialog", { name: "Choose a cover" });
  const words = chooser.getByRole("searchbox", { name: "Search the catalogues" });
  const said = chooser.getByTestId("choose-status");
  await expect(words).toHaveValue("Oil 101 Downey");
  await expect(words).toBeFocused();
  await expect(said).toHaveText("3 pictures found."); // searched at once, with the title and surname
  await expect(chooser.getByRole("button", { name: /^Use this cover: / })).toHaveCount(3);
  await expect(chooser.getByRole("img", { name: "Cover of Oil 101 Downey (1)" })).toHaveAttribute("src", /^data:image\/png;base64,/);
  await words.fill("nothing like it");
  await chooser.getByRole("button", { name: "Search" }).click();
  await expect(said).toContainText("Nothing with a cover for these words.");
  await expect(chooser.getByRole("button", { name: /^Use this cover: / })).toHaveCount(0);
  await words.fill("Oil 101 Downey");
  await words.press("Enter");
  await expect(said).toHaveText("3 pictures found.");
  await chooser.getByRole("button", { name: "Use this cover: Oil 101 Downey (2)" }).click();
  await expect(chooser).toHaveCount(0);
  await expect(reader.getByTestId("reject-status")).toHaveText("“Oil 101”: the cover you chose is shown.");
  const oil = reader.locator('[data-testid="found-covers"] li[data-title="Oil 101"]');
  const oilPicture = oil.getByRole("img", { name: "Cover found for Oil 101" });
  await expect.poll(() => oilPicture.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120);
  await expect(oil.getByRole("link", { name: "From the test catalogue" })).toHaveAttribute("href", "https://catalogue.example.org/fake/oil-101-downey");
  await expect(reader.getByTestId("no-cover").getByRole("listitem")).toHaveText([/^The Grid/]);

  // Choose another: Escape closes it with nothing changed, the keyboard back on the button; then another result.
  const another = oil.getByRole("button", { name: "Choose another cover: Oil 101" });
  await another.click();
  await expect(said).toHaveText("3 pictures found.");
  await reader.keyboard.press("Escape");
  await expect(chooser).toHaveCount(0);
  await expect(another).toBeFocused();
  const chosen = (await oilPicture.getAttribute("src"))!.split("?")[0];
  await another.click();
  await expect(said).toHaveText("3 pictures found.");
  await chooser.getByRole("button", { name: "Use this cover: Oil 101 Downey (3)" }).click();
  await expect.poll(async () => (await oilPicture.getAttribute("src"))?.split("?")[0]).not.toBe(chosen);

  // In the Library, a title not available yet shows its found cover in grey, still said to be not available.
  await reader.goto("/library");
  await reader.getByText(/^Not available yet \(\d+\)$/).click();
  const item = (title: string) => reader.getByTestId("not-yet").getByRole("listitem").filter({ has: reader.getByText(title, { exact: true }) }).getByRole("link");
  const chipWar = item("Chip War");
  const greyed = chipWar.locator('[data-cover="picture"] img');
  await expect(greyed).toHaveCount(1);
  expect(await greyed.evaluate((i) => [getComputedStyle(i).filter, getComputedStyle(i).opacity])).toEqual(["grayscale(1)", "0.55"]);
  await expect(chipWar).toContainText("Not available yet");
  await expect(item("The Grid").locator("img")).toHaveCount(0);
  await expect(reader.getByRole("link", { name: "review covers" })).toHaveAttribute("href", "/covers");
  await mkdir("screenshots", { recursive: true });
  await picturesLoaded(reader);
  await chipWar.scrollIntoViewIfNeeded();
  await reader.screenshot({ path: "screenshots/covers-library-not-yet-desktop-light.png" });

  // On the Path too.
  await reader.goto("/paths/hidden-machinery");
  const onPath = reader.getByRole("link", { name: "Chip War (not available yet)" }).locator('[data-cover="picture"] img');
  await expect(onPath).toHaveCount(1);
  expect(await onPath.evaluate((i) => getComputedStyle(i).filter)).toBe("grayscale(1)");
  await reader.goto("/library");
  await reader.getByText(/^Not available yet \(\d+\)$/).click();

  // The title's own page says where its cover came from, with a way to the Covers page.
  await chipWar.click();
  await expect(reader.getByTestId("cover-credit")).toHaveText("Cover found in a catalogue by title and author. Not the right cover?");
  await expect(reader.getByRole("link", { name: "Not the right cover?" })).toHaveAttribute("href", "/covers");

  // Cmd+K (Ctrl+K) knows the page.
  await reader.keyboard.press("ControlOrMeta+k");
  await reader.getByRole("combobox", { name: "Go to a book, path, page or note" }).fill("covers");
  await reader.keyboard.press("Enter");
  await expect(reader).toHaveURL(/\/covers$/);

  await fourLooks(reader, "covers", async () => {
    await expect(reader.getByRole("heading", { name: "Covers", level: 1 })).toBeVisible();
    await picturesLoaded(reader);
  });
  // The chooser open, in the four looks too (opened again after each reload).
  await fourLooks(reader, "covers-choose", async () => {
    await reader.locator('[data-testid="found-covers"] li[data-title="Oil 101"]').getByRole("button", { name: "Choose another cover: Oil 101" }).click();
    await expect(reader.getByTestId("choose-status")).toHaveText("3 pictures found.");
    await picturesLoaded(reader);
  });
  await reader.context().close();
});
