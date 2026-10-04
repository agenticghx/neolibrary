import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { pages } from "./pages";

for (const { name, path, signedIn, click } of pages) {
  test(`${name} has no accessibility or contrast violations`, async ({ page }) => {
    if (!signedIn) await page.context().clearCookies();
    await page.goto(path);
    if (click) await page.getByRole("link", { name: click, exact: true }).click();
    if (click) await page.waitForURL((u) => u.pathname !== path);
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`);
    expect(summary).toEqual([]);
  });
}
