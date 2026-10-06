import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { pages } from "./pages";

for (const { name, path, signedIn, click } of pages.filter((p) => !p.spec)) {
  test(`${name} has no accessibility or contrast violations`, async ({ page }) => {
    if (!signedIn) await page.context().clearCookies();
    await page.goto(path);
    // Open linked pages by URL (not by clicking), so no hover or focus state leaks into the screenshot.
    if (click) await page.goto((await page.getByRole("link", { name: click, exact: true }).getAttribute("href"))!);
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`);
    expect(summary).toEqual([]);
  });
}
