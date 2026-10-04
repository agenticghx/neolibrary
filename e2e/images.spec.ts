import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { ADMIN_STATE } from "./pages";

// M9 "Done when" (part): searching "silicon wafer" against the fake returns results.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

async function openReader(page: Page) {
  await page.goto(`/search?q=${encodeURIComponent('"a volume of some dry divinity"')}`);
  await page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "divinity" }).first().click();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
}

async function selectPhrase(page: Page, phrase: string) {
  await page.evaluate((phrase) => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue!.indexOf(phrase);
        if (i < 0) continue;
        const r = doc.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + phrase.length);
        doc.getSelection()!.removeAllRanges();
        doc.getSelection()!.addRange(r);
        return;
      }
    }
    throw new Error(`phrase not on this page: ${phrase}`);
  }, phrase);
}

async function seeIt(page: Page, phrase: string) {
  await selectPhrase(page, phrase);
  await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "See it" }).click();
  return page.getByRole("region", { name: "See it" });
}

test("see it: pictures of a phrase, each with its credit and licence; searching silicon wafer finds results", async ({ page }) => {
  await openReader(page);
  const panel = await seeIt(page, "a candle");
  await expect(panel.getByLabel("Search pictures")).toHaveValue("a candle");
  await expect(panel).toContainText("No pictures found for “a candle”.");

  await panel.getByLabel("Search pictures").fill("silicon wafer");
  await panel.getByRole("button", { name: "Search" }).click();
  const results = panel.getByTestId("image-results").locator("li");
  await expect(results).toHaveCount(3);
  await expect(results.nth(0)).toContainText("Silicon wafer 1 (test image)");
  await expect(results.nth(0)).toContainText("Test photographer 1 · CC BY-SA 4.0 · Source");
  await expect(results.nth(1)).toContainText("Public domain");
  await expect(results.nth(0).getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/4.0");
  // The pictures load (and the page's security policy allows them).
  const img = results.nth(0).getByRole("img", { name: "Silicon wafer 1 (test image)" });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(480);

  const api = await page.request.get("/api/images/search?q=silicon%20wafer");
  expect((await api.json()).results).toHaveLength(3);
  const anon = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.get(new URL("/api/images/search?q=wafer", page.url()).href)).status()).toBe(401);
  await anon.close();
});

test("no good picture: make one with AI, labelled as generated, paid once and shown again for free", async ({ page }) => {
  await openReader(page);
  let panel = await seeIt(page, "a candle");
  await expect(panel).toContainText("No pictures found for “a candle”.");
  const make = panel.getByRole("button", { name: "Make a picture of “a candle” (about $0.20)" });
  await expect(make).toBeVisible();
  const made = page.waitForResponse((r) => r.url().endsWith("/pictures") && r.request().method() === "POST");
  await make.click();
  expect((await made).status()).toBe(201);
  const card = page.getByTestId("generated-picture");
  await expect(card).toContainText("Generated image · made by AI, not a photograph");
  await expect(card).toContainText(/fake-image · \d+ \w+ \d{4} · \$0\.20/);
  const img = card.getByRole("img", { name: "Generated picture of a candle" });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(96);

  // Asked again later: the stored picture, no button and no second payment.
  await page.getByRole("button", { name: /^Notes/ }).click();
  panel = await seeIt(page, "a candle");
  await expect(page.getByTestId("generated-picture")).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Make a picture/ })).toHaveCount(0);
});

test("pin a picture to a passage: it survives a reload, with its credit, and opens from the passage", async ({ page }) => {
  await openReader(page);
  const notesButton = page.getByRole("button", { name: /^Notes/ });
  const before = Number(/\((\d+)\)/.exec((await notesButton.textContent()) ?? "")?.[1] ?? 0);
  const panel = await seeIt(page, "the clock of the neighbouring church");
  await panel.getByLabel("Search pictures").fill("silicon wafer");
  await panel.getByRole("button", { name: "Search" }).click();
  const first = panel.getByTestId("image-results").locator("li").first();
  await first.getByRole("button", { name: "Pin to the passage" }).click();
  await expect(first.getByRole("status")).toHaveText("Pinned to the passage");
  await expect(notesButton).toHaveText(`Notes (${before + 1})`);

  await page.reload();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(notesButton).toHaveText(`Notes (${before + 1})`);
  await notesButton.click();
  const item = page.getByTestId("notes").locator("li").filter({ hasText: "Pinned picture" });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("the clock of the neighbouring church");
  await expect(item).toContainText("Silicon wafer 1 (test image) · Test photographer 1 · CC BY-SA 4.0 · Source");
  const img = item.getByRole("img", { name: "Silicon wafer 1 (test image)" });
  await img.scrollIntoViewIfNeeded();
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(480);

  // Clicking the passage in the book opens the picture's card.
  await notesButton.click();
  const point = await page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue!.indexOf("neighbouring church");
        if (i < 0) continue;
        const r = doc.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 5);
        const box = r.getBoundingClientRect();
        const frame = (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect();
        return { x: frame.left + box.left + box.width / 2, y: frame.top + box.top + box.height / 2 };
      }
    }
    return null;
  });
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  const card = page.getByRole("region", { name: "Pinned picture" });
  await expect(card).toContainText("the clock of the neighbouring church");
  await expect(card).toContainText("Test photographer 1");
  await page.screenshot({ path: "screenshots/reader-pinned-picture.png" });
});

test("the see-it panel is accessible, and looks right on phone and desktop, light and dark", async ({ page }) => {
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await openReader(page);
      const panel = await seeIt(page, "a candle");
      await panel.getByLabel("Search pictures").fill("silicon wafer");
      await panel.getByRole("button", { name: "Search" }).click();
      await expect(panel.getByTestId("image-results").locator("img").first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-see-it-${name}-${scheme}.png` });
    }
  }
});
