import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { ADMIN_STATE } from "./pages";

// M6 (b): rewrite a paragraph in the reader, with the fake AI (AI_FAKE=1 in
// the test server). Versions are stored and re-served, never re-bought.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

const reader = (page: Page) => page.getByTestId("reader");
const panel = (page: Page) => page.getByRole("region", { name: "Rewrite" });
const rewrite = (page: Page) => page.getByTestId("rewrite");

async function openAtPhrase(page: Page, phrase: string) {
  await page.goto(`/search?q=${encodeURIComponent(`"${phrase}"`)}`);
  await page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: phrase.split(" ")[0] }).first().click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
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

async function openRewrite(page: Page, phrase: string) {
  await selectPhrase(page, phrase);
  await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Rewrite" }).click();
  await expect(panel(page)).toContainText("A new rewrite costs");
}

const bookIdOf = (page: Page) => /\/books\/([0-9a-f-]{36})\/read/.exec(page.url())![1];

test("rewrite a paragraph at two levels, flip between versions, and get them back after a reload", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary");
  await openRewrite(page, "lover of the sane and customary");
  await expect(panel(page)).toContainText("Search for Mr. Hyde");
  await expect(panel(page)).toContainText("Mr. Utterson came home to his bachelor house"); // the paragraph, shown above
  await expect(rewrite(page)).toHaveCount(0);

  await panel(page).getByRole("button", { name: "Plain English" }).click();
  await expect(rewrite(page)).toContainText("Rewrite · Plain English · written by the test AI");
  await expect(rewrite(page)).toContainText("Fake rewrite (plain english): ");
  await expect(rewrite(page)).toContainText(/fake · \d+ \w+ \d{4} · \$0\.\d+/);
  await expect(panel(page)).toContainText("Version 1 of 1");

  await panel(page).getByRole("button", { name: "Shorter" }).click();
  await expect(rewrite(page)).toContainText("Rewrite · Shorter");
  await expect(panel(page)).toContainText("Version 2 of 2");
  await panel(page).getByRole("button", { name: "Earlier version" }).click();
  await expect(rewrite(page)).toContainText("Rewrite · Plain English");

  // Asking for Plain English again re-serves the stored version: no new version, no second call.
  await panel(page).getByRole("button", { name: "Plain English" }).click();
  await expect(panel(page)).toContainText("Version 1 of 2");

  // The book's own text is untouched.
  const frameText = await page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    return view.renderer.getContents().map(({ doc }) => doc.body.textContent).join(" ");
  });
  expect(frameText).toContain("lover of the sane and customary");
  expect(frameText).not.toContain("Fake rewrite");

  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await openRewrite(page, "lover of the sane and customary");
  await expect(panel(page)).toContainText("Version 2 of 2");
  await expect(rewrite(page)).toContainText("Rewrite · Shorter");

  // "Try again" pays for a new version on purpose.
  await panel(page).getByRole("button", { name: "Try again" }).click();
  await expect(panel(page)).toContainText("Version 3 of 3");
  await expect(rewrite(page)).toContainText("Rewrite · Shorter");

  // Bad input is refused.
  const res = await page.request.post(`/api/books/${bookIdOf(page)}/rewrites`, { data: { sectionId: "nope", level: "plain" } });
  expect(res.status()).toBe(400);
});

test("the stored versions carry their provenance", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary");
  await openRewrite(page, "lover of the sane and customary");
  await expect(panel(page)).toContainText("Version 3 of 3");
  const url = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/rewrites?cfi=")));
  const data = await (await page.request.get(url!)).json();
  expect(data.versions.map((v: { options: { level: string } }) => v.options.level)).toEqual(["plain", "shorter", "shorter"]);
  for (const v of data.versions) {
    expect(v.provenance).toMatchObject({
      provider: "anthropic",
      model: "fake",
      promptName: expect.stringMatching(/^rewrite \+ rewrite-levels\//),
      promptHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      inputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(v.provenance.costUsd).toBeGreaterThan(0);
  }
  // Signed-out visitors get nothing.
  const anon = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.get(url!)).status()).toBe(401);
  await anon.close();
});

test("the rewrite panel is accessible, and looks right on phone and desktop, light and dark", async ({ page }) => {
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await openAtPhrase(page, "lover of the sane and customary");
      await openRewrite(page, "lover of the sane and customary");
      await expect(rewrite(page)).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `screenshots/reader-rewrite-${name}-${scheme}.png` });
    }
  }
});
