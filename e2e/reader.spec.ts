import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { readableEpub } from "../lib/library/test-epub";
import { ADMIN_STATE } from "./pages";

// M4 "Done when" (part): open a book, change font size, reload: it reopens at
// the same spot.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

const reader = (page: Page) => page.getByTestId("reader");
const cfiStart = (cfi: string | null) => (cfi ?? "").split(",")[0];

async function openJekyll(page: Page) {
  await page.goto("/shelf");
  await page.getByTestId("shelf").getByRole("link", { name: /^The Strange Case/ }).click();
  await expect(page.getByRole("heading", { name: /^The Strange Case/, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /^(Read|Continue reading)$/ }).click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
}

async function savedPosition(page: Page, title: RegExp) {
  const data = await (await page.request.get("/api/export")).json();
  return data.books.find((b: { title: string }) => title.test(b.title))?.position ?? null;
}

test("open a book, turn pages, change the text size, reload: same spot", async ({ page }) => {
  await openJekyll(page);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next page" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Story of the Door").last()).toBeVisible();

  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Larger text" }).click();
  await page.getByRole("button", { name: "Larger text" }).click();
  await expect(page.getByTestId("text-size")).toHaveText("120%");
  await page.keyboard.press("Escape");

  // Wait until the position on the page has been saved on the server.
  let before = "";
  await expect
    .poll(async () => {
      before = (await reader(page).getAttribute("data-cfi")) ?? "";
      return before !== "" && (await savedPosition(page, /^The Strange Case/)) === before;
    }, { timeout: 10_000 })
    .toBe(true);
  expect(before).toMatch(/^epubcfi\(/);

  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByTestId("text-size")).toHaveText("120%");
  await expect.poll(async () => cfiStart(await reader(page).getAttribute("data-cfi"))).toBe(cfiStart(before));

  // The shelf and book page show the progress too.
  await page.goto("/shelf");
  await expect(page.getByTestId("shelf").getByText(/% read$/).first()).toBeVisible();
});

test("contents jump to a chapter; layout can switch to scrolling", async ({ page }) => {
  await openJekyll(page);
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "Search for Mr. Hyde" }).click();
  await expect(page.locator("footer").getByText("Search for Mr. Hyde")).toBeVisible();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("button", { name: "Scroll" }).click();
  await expect(page.getByRole("button", { name: "Scroll" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pages" }).click(); // back to the default for later tests
});

test("scripts inside a book never run", async ({ page }) => {
  const evil = readableEpub("Trap Book", [
    `<p>Nothing to see.</p><script>document.title = "pwned"; try { parent.document.title = "pwned"; parent.postMessage("pwned", "*"); } catch (e) {}</script><img src="x" onerror="parent.document.title='pwned'"/>`,
  ]);
  await page.goto("/shelf");
  await page.getByLabel("Choose files").setInputFiles({ name: "trap.epub", mimeType: "application/epub+zip", buffer: Buffer.from(evil) });
  await expect(page.getByTestId("upload-results").getByText("Added to your shelf")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __msgs: string[] }).__msgs = [];
    addEventListener("message", (e) => (window as unknown as { __msgs: string[] }).__msgs.push(String(e.data)));
  });
  await page.getByTestId("shelf").getByRole("link", { name: /^Trap Book/ }).click();
  await expect(page.getByRole("heading", { name: "Trap Book", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Read", exact: true }).click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await expect(page).toHaveTitle(/Reading · Neolibrary/);
  expect(await page.evaluate(() => (window as unknown as { __msgs?: string[] }).__msgs ?? [])).not.toContain("pwned");
});

test("the reader is accessible, and looks right on phone and desktop, light and dark", async ({ page }) => {
  await openJekyll(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Screenshots for the PR grid (book text renders inside the book frame).
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `screenshots/reader-${name}-${scheme}.png` });
    }
  }
});
