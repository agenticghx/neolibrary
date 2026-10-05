import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// M14 step 2: the sidebar on desktop; tabs, a top strip and an account menu on
// a phone. Runs after the uploads project (the library has books), before the
// reader. Never signs the owner out (the other projects share the session).

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });

// In order, one at a time: one test adds and removes a collection the others would see.
test.describe.configure({ mode: "default" });

test.describe("desktop sidebar", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("every link opens its page and is marked as the current one", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByTestId("tab-bar")).toBeHidden();
    const cases: [string | RegExp, RegExp, string][] = [
      ["Home", /:\d+\/$/, "Hidden Machinery"],
      ["All", /\/library$/, "Your library"],
      ["Want to Read", /\/library\?show=want$/, "Your library"],
      ["Finished", /\/library\?show=finished$/, "Your library"],
      ["Books", /\/library\?show=books$/, "Your library"],
      ["Audiobooks", /\/library\?show=audiobooks$/, "Your library"],
      ["PDFs", /\/library\?show=pdfs$/, "Your library"],
      // A Path shows how many of its numbered pillars are started.
      [/^Hidden Machinery \d+ of \d+ pillars started$/, /\/paths\/hidden-machinery$/, "Hidden Machinery"],
      ["New path", /\/paths$/, "Your paths"],
    ];
    for (const [name, url, heading] of cases) {
      const link = sidebar(page).getByRole("link", typeof name === "string" ? { name, exact: true } : { name });
      await link.click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "page");
      await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);
    }

    // The search box searches books and notes (Enter submits; no button of its own).
    await page.getByRole("searchbox", { name: "Search your library" }).fill("countenance");
    await page.getByRole("searchbox", { name: "Search your library" }).press("Enter");
    await expect(page).toHaveURL(/\/search\?q=countenance$/);
    await expect(page.getByRole("button", { name: "Search" })).toHaveCount(1);

    // The foot: account links, Invite for an admin, and Sign out.
    for (const [name, url] of [
      ["Reading stats", /\/stats$/],
      ["Your data", /\/data$/],
      ["Invite", /\/admin\/invites$/],
    ] as const) {
      await page.getByRole("complementary").getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("a new collection appears in the sidebar at once, and leaves with it", async ({ page }) => {
    await page.goto("/");
    await sidebar(page).getByRole("link", { name: "New collection", exact: true }).click();
    await expect(page).toHaveURL(/\/library\?new=collection$/);
    await page.getByLabel("Collection name").fill("Sidebar test");
    await page.getByRole("button", { name: "Create" }).click();
    const link = sidebar(page).getByRole("link", { name: "Sidebar test", exact: true });
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(/\/library\?c=/);
    await page.getByRole("button", { name: "Delete collection" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(link).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("tabs open their pages; nothing hides under them; no sideways scroll", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByRole("complementary")).toBeHidden();
    const tabs = page.getByTestId("tab-bar");
    await expect(tabs.getByRole("link")).toHaveText(["Home", "Library", "Paths", "Search"]);
    for (const [name, url, heading] of [
      ["Library", /\/library$/, "Your library"],
      ["Paths", /\/paths$/, "Your paths"],
      ["Search", /\/search$/, "Find a passage"],
      ["Home", /:\d+\/$/, "Hidden Machinery"],
    ] as const) {
      await tabs.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(tabs.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
    // A Path page counts as the Paths tab.
    await page.goto("/paths/hidden-machinery");
    await expect(tabs.getByRole("link", { name: "Paths", exact: true })).toHaveAttribute("aria-current", "page");

    // Scrolled to the end, the page's last line sits above the tab bar, not under it.
    await page.goto("/library");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastLine = page.getByText("Your library is yours:");
    const [lineBox, tabsBox] = [await lastLine.boundingBox(), await tabs.boundingBox()];
    expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(tabsBox!.y);
  });

  test("the account menu holds the account links and Sign out, and closes", async ({ page }) => {
    const button = page.getByRole("button", { name: /^Account: / });
    // Each colour scheme from a fresh page: switching on an open page measures colours mid-transition.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/library");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      for (const name of ["Reading stats", "Your data", "Invite"]) await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await page.screenshot({ path: `screenshots/account-menu-phone-${scheme}.png` });
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.any[0]?.message ?? ""})`).join("; ")}`)).toEqual([]);
    }
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // It closes when a link inside it opens another page.
    await button.click();
    await page.getByRole("link", { name: "Your data", exact: true }).click();
    await expect(page).toHaveURL(/\/data$/);
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });
});
