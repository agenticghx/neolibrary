import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { pages } from "./pages";

for (const { name, path } of pages) {
  test(`${name} has no accessibility or contrast violations`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`);
    expect(summary).toEqual([]);
  });
}

test("health endpoint answers", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", service: "neolibrary" });
});

test("home sends visitors to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
