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
  // The reader is opened from search without a full page load, so the policy is the one on this document.
  const documentPage = page.waitForResponse((r) => r.request().resourceType() === "document" && r.ok());
  await openReader(page);
  expect((await documentPage).headers()["content-security-policy"]).toContain("https://thumb.wikimedia.org");
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
  // The thumbnail's own width (480) must not push the card wider than the panel, or the credit is clipped.
  const fit = await img.evaluate((el) => {
    const card = el.closest("section")!;
    const picture = el.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const hint = [...card.querySelectorAll("p")].find((p) => p.textContent?.includes("Wikimedia"));
    return {
      overflowX: card.scrollWidth - card.clientWidth,
      inside: picture.left >= box.left - 1 && picture.right <= box.right + 1,
      hintClip: hint ? hint.scrollWidth - hint.clientWidth : -1,
    };
  });
  expect(fit.overflowX).toBeLessThanOrEqual(1);
  expect(fit.inside).toBe(true);
  expect(fit.hintClip).toBeGreaterThanOrEqual(0);
  expect(fit.hintClip).toBeLessThanOrEqual(1);

  const api = await page.request.get("/api/images/search?q=silicon%20wafer");
  expect((await api.json()).results).toHaveLength(3);
  const anon = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.get(new URL("/api/images/search?q=wafer", page.url()).href)).status()).toBe(401);
  await anon.close();

  // Escape closes the panel, even with a button in it focused (M19 P1b: the button no longer swallows the key).
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready");
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

// M19 P1 (the site review's first finding): on a computer every panel opens in a column beside the book, so
// the passage you asked about stays readable; the book narrows and keeps your place. A phone keeps the card.
test("panels open beside the book on a computer, never over it, and the reading place stays", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReader(page);
  const reader = page.getByTestId("reader");
  const book = page.locator("foliate-view");
  const close = () => page.keyboard.press("Escape");
  const clickPassage = async (text: string) => {
    const point = await page.evaluate((text) => {
      const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
      for (const { doc } of view.renderer.getContents()) {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.nodeValue!.indexOf(text);
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
    }, text);
    expect(point).not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
  };
  const panels: [string, () => Promise<void>][] = [
    ["Notes", () => page.getByRole("button", { name: /^Notes/ }).click()],
    ["Reading settings", () => page.getByRole("button", { name: "Reading settings" }).click()],
    ["What do I need to know?", () => page.getByRole("button", { name: "What do I need to know?" }).click()],
    [
      "Test yourself",
      async () => {
        await page.getByRole("button", { name: "What do I need to know?" }).click();
        await page.getByRole("button", { name: /^Test yourself on this chapter/ }).click();
      },
    ],
    ["Elsewhere in your library", () => page.getByRole("button", { name: /links? to your other books$/ }).click()],
    [
      "See it",
      async () => {
        await selectPhrase(page, "a candle");
        await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "See it" }).click();
      },
    ],
    [
      "Rewrite",
      async () => {
        await selectPhrase(page, "a candle");
        await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Rewrite" }).click();
      },
    ],
    ["Pinned picture", () => clickPassage("neighbouring church")],
  ];
  await mkdir("screenshots", { recursive: true });
  for (const [name, open] of panels) {
    await expect(reader).toHaveAttribute("data-cfi", /^epubcfi\(/);
    const place = await reader.getAttribute("data-cfi");
    await open();
    const panel = page.getByRole(name === "Notes" ? "navigation" : "region", { name, exact: true });
    await expect(panel, name).toBeVisible();
    // The book narrows to make room: its box ends where the panel's begins.
    await expect
      .poll(async () => {
        const p = (await panel.boundingBox())!;
        const b = (await book.boundingBox())!;
        return b.x + b.width <= p.x + 0.5;
      }, { message: `${name} beside the book` })
      .toBe(true);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
    expect(results.violations.map((v) => `${name} · ${v.id}: ${v.help}`)).toEqual([]);
    if (name === "Notes" || name === "Rewrite") {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-panel-${name.toLowerCase()}-desktop-light.png` });
    }
    await close();
    await expect(panel, name).toBeHidden();
    // Laid out again at full width, the book is back at the same place.
    await expect.poll(() => reader.getAttribute("data-cfi"), { message: `${name}: same place after closing` }).toBe(place);
  }

  // With Side by side on, the panel is a third column: the page and the rewrite both stay uncovered.
  const view = page.getByRole("button", { name: "Rewritten view" });
  const show = page.getByRole("group", { name: "Show" });
  // The view is the account's (M17 R4): note it, so it can be put back for the tests after this one.
  const was = (await view.getAttribute("aria-pressed")) === "true" ? await show.locator('[aria-pressed="true"]').textContent() : "Original";
  if (was === "Original") await view.click();
  await show.getByRole("button", { name: "Side by side" }).click();
  const pane = page.getByRole("region", { name: "Rewritten" });
  await expect(pane).toBeVisible();
  await page.getByRole("button", { name: /^Notes/ }).click();
  const notes = page.getByRole("navigation", { name: "Notes" });
  await expect(notes).toBeVisible();
  await expect(pane).toBeVisible();
  await expect
    .poll(async () => {
      const n = (await notes.boundingBox())!;
      const b = (await book.boundingBox())!;
      const r = (await pane.boundingBox())!;
      return b.x + b.width <= r.x + 0.5 && r.x + r.width <= n.x + 0.5 && b.width > 300;
    }, { message: "page, rewrite, then Notes, side by side" })
    .toBe(true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/reader-panel-side-by-side-desktop-light.png" });
  await page.getByRole("button", { name: /^Notes/ }).click();
  await expect(notes).toBeHidden();
  await expect(pane).toBeVisible();
  await show.getByRole("button", { name: was!, exact: true }).click();
  await expect(view).toHaveAttribute("aria-pressed", String(was !== "Original"));

  // Dark, for the screenshot grid.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: /^Notes/ }).click();
  await expect(notes).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/reader-panel-notes-desktop-dark.png" });
  await page.getByRole("button", { name: /^Notes/ }).click();
  await page.emulateMedia({ colorScheme: "light" });

  // A phone keeps the card over the page: there is no room for a column.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Notes/ }).click();
  await expect(notes).toBeVisible();
  expect(await notes.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  await page.getByRole("button", { name: /^Notes/ }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
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
