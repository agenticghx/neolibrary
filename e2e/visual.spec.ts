import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { pages } from "./pages";

for (const { name, path, signedIn, click } of pages.filter((p) => !p.spec)) {
  test(`${name} looks as approved`, async ({ page }, testInfo) => {
    if (!signedIn) await page.context().clearCookies();
    await page.goto(path);
    // Open linked pages by URL (not by clicking), so no hover or focus state leaks into the screenshot.
    if (click) await page.goto((await page.getByRole("link", { name: click, exact: true }).getAttribute("href"))!);
    await page.evaluate(() => document.fonts.ready);
    // One throwaway full-page capture first. On CI's Linux machines the first full-page capture changes the layout:
    // /design's code labels (system monospace) switch font as the capture paints them, and the page grows 2 px
    // (3285 to 3287), so the check's first two shots differed and it ran out of time (every run on main since
    // 2026-11-05; reproduced in the Linux image with linux-run.sh, see docs/ci-flakes.md). Scrolling to the foot
    // did not do it; a capture does, and every capture after the first is the same height.
    await page.screenshot({ fullPage: true, type: "jpeg", quality: 10 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });

    // Copy for the PR screenshot grid (posted as a comment by CI).
    await mkdir("screenshots", { recursive: true });
    await page.screenshot({ path: `screenshots/${name}-${testInfo.project.name}.png`, fullPage: false });
  });
}
