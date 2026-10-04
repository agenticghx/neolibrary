import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { pages } from "./pages";

for (const { name, path, signedIn } of pages) {
  test(`${name} looks as approved`, async ({ page }, testInfo) => {
    if (!signedIn) await page.context().clearCookies();
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });

    // Copy for the PR screenshot grid (posted as a comment by CI).
    await mkdir("screenshots", { recursive: true });
    await page.screenshot({ path: `screenshots/${name}-${testInfo.project.name}.png`, fullPage: false });
  });
}
