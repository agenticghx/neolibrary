import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { hiddenMachinery } from "../data/paths/hidden-machinery";
import { ADMIN } from "./pages";

// M14 step 2: the sidebar on desktop; tabs on a phone, and the account menu on
// Home only (step 3b, Samuel's choice B). M18: the account menu opens above the
// name at the foot of the sidebar (computer A), and as a sheet from the bottom
// on a phone (phone B). Runs after the uploads project (the
// library has books), before the reader. Never signs the owner out (the other
// projects share the session).

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const aside = (page: Page) => page.getByRole("complementary", { name: "Sidebar" });
// No book on the Path has progress yet when this project runs (the reader comes later).
const PILLARS = hiddenMachinery.pillars.filter((p) => p.group !== "master" && p.group !== "suggested").length;

// In order, one at a time: one test adds and removes a collection the others would see.
test.describe.configure({ mode: "default" });

test.describe("desktop sidebar", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("every link opens its page and is marked as the current one", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByTestId("tab-bar")).toBeHidden();
    const cases: [string | RegExp, RegExp, string][] = [
      ["Home", /:\d+\/$/, "Home"],
      ["All", /\/library$/, "Your library"],
      ["Want to Read", /\/library\?show=want$/, "Want to Read"],
      ["Finished", /\/library\?show=finished$/, "Finished"],
      ["Books", /\/library\?show=books$/, "Books"],
      ["Audiobooks", /\/library\?show=audiobooks$/, "Audiobooks"],
      ["PDFs", /\/library\?show=pdfs$/, "PDFs"],
      // M14 follow-up V3b (Samuel, #90): the Import page, from the Library list.
      ["Import", /\/import$/, "Import"],
      // A Path shows how many of its numbered pillars are started.
      [`Hidden Machinery 0 of ${PILLARS} pillars started`, /\/paths\/hidden-machinery$/, "Hidden Machinery"],
      ["New path", /\/paths\/new$/, "A new path"],
    ];
    for (const [name, url, heading] of cases) {
      const link = sidebar(page).getByRole("link", typeof name === "string" ? { name, exact: true } : { name });
      await link.click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "page");
      await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);
    }

    // Import is the last item of the Library list, after PDFs (M14 follow-up V3b).
    const libraryList = sidebar(page).getByRole("list", { name: "Library", exact: true });
    await expect(libraryList.getByRole("link")).toHaveText(["All", "Want to Read", "Finished", "Books", "Audiobooks", "PDFs", "Import"]);
    // With a book chosen for its audiobook (/import?book=…#audio-h), Import is still the current page.
    const importItem = libraryList.getByRole("link", { name: "Import", exact: true });
    await importItem.click();
    await page.getByLabel("Book", { exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Choose", exact: true }).click();
    await expect(page).toHaveURL(/\/import\?book=[0-9a-f-]+#audio-h$/);
    await expect(importItem).toHaveAttribute("aria-current", "page");
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);

    // The search box searches books and notes (Enter submits; no button of its own).
    await page.getByRole("searchbox", { name: "Search your library" }).fill("countenance");
    await page.getByRole("searchbox", { name: "Search your library" }).press("Enter");
    await expect(page).toHaveURL(/\/search\?q=countenance$/);
    await expect(page.getByRole("button", { name: "Search" })).toHaveCount(1);

    // The foot: the reader's initial and name, in view on a laptop screen (the links above it scroll).
    // A click opens the account menu (M18): the account links, Invite for an admin, and Sign out.
    const who = aside(page).getByRole("button", { name: `Account: ${ADMIN.name}` });
    await expect(who).toBeInViewport();
    await expect(aside(page).getByRole("button", { name: "Sign out" })).toBeHidden();
    for (const [name, url, heading] of [
      ["Reading stats", /\/stats$/, "Reading stats"],
      ["Your data", /\/data$/, "No lock-in"],
      ["Get help", /\/help$/, "How the library works"],
      ["Account", /\/account$/, "Account"],
      ["Invite", /\/admin\/invites$/, "Invite people"],
    ] as const) {
      await who.click();
      await aside(page).getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      // The new page closes the menu.
      await expect(who).toHaveAttribute("aria-expanded", "false");
      if (name === "Account") {
        await expect(page.getByLabel("Current password")).toBeVisible();
        await expect(page.getByLabel("New password")).toBeVisible();
        await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Sign out of other sessions" })).toBeVisible();
      }
      if (name === "Invite") {
        await expect(page.getByRole("heading", { name: "Readers", level: 2 })).toBeVisible();
        await expect(page.getByRole("button", { name: "Disable Ada Lovelace" })).toBeVisible();
      }
    }

    // /paths lists the Path with its count, and offers no reading list already added.
    await page.goto("/paths");
    await expect(page.getByRole("main").getByText(`0 of ${PILLARS} pillars started`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add this path" })).toHaveCount(0);
  });

  test("the account menu opens above the name, like the Claude app's, and closes", async ({ page }) => {
    const who = aside(page).getByRole("button", { name: `Account: ${ADMIN.name}` });
    // Each colour scheme from a fresh page: switching on an open page measures colours mid-transition.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
      // Home has no account button of its own on desktop: the account is at the foot of the sidebar.
      await expect(page.getByRole("main").getByRole("button", { name: /^Account: / })).toHaveCount(0);
      // Closed: the initial, the name and the arrow; no links.
      await expect(who).toHaveText(`${ADMIN.name.charAt(0)}${ADMIN.name}`);
      await expect(who).toHaveAttribute("aria-expanded", "false");
      await expect(aside(page).getByRole("link", { name: "Reading stats", exact: true })).toBeHidden();
      await who.click();
      await expect(who).toHaveAttribute("aria-expanded", "true");
      const menu = page.locator(`[id="${await who.getAttribute("aria-controls")}"]`);
      // The email in grey at the top; Account, Reading stats, Your data | Invite | Sign out last.
      await expect(menu.locator("p").first()).toHaveText(ADMIN.email);
      await expect(menu.getByRole("link")).toHaveText(["Account", "Reading stats", "Your data", "Get help", "Invite"]);
      await expect(menu.getByRole("separator")).toHaveCount(2);
      await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
      // A card above the name, over the bottom of the list, inside the sidebar.
      const [menuBox, whoBox, asideBox] = [await menu.boundingBox(), await who.boundingBox(), await aside(page).boundingBox()];
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(whoBox!.y);
      expect(menuBox!.x).toBeGreaterThanOrEqual(asideBox!.x);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(asideBox!.x + asideBox!.width);
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      await page.screenshot({ path: `screenshots/account-menu-desktop-${scheme}.png` });
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.any[0]?.message ?? ""})`).join("; ")}`)).toEqual([]);
    }
    // Escape closes it and gives focus back to the name.
    await page.getByRole("link", { name: "Your data", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(who).toHaveAttribute("aria-expanded", "false");
    await expect(who).toBeFocused();
    // A click on the page closes it, and so does the name again.
    await who.click();
    await page.getByRole("heading", { level: 1, name: "Home" }).click();
    await expect(who).toHaveAttribute("aria-expanded", "false");
    await who.click();
    await who.click();
    await expect(who).toHaveAttribute("aria-expanded", "false");
    // Tab past Sign out (into the page) closes it.
    await who.click();
    await page.getByRole("button", { name: "Sign out" }).focus();
    await page.keyboard.press("Tab");
    await expect(who).toHaveAttribute("aria-expanded", "false");
  });

  test("the first Tab offers to skip the navigation", async ({ page }) => {
    await page.goto("/library");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to the page" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("#content")).toBeFocused();
    // The next Tab goes into the page, and the wrapper stops being focusable
    // (otherwise Safari would focus it on every click in the page).
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.getElementById("content")!.contains(document.activeElement) && document.activeElement !== document.getElementById("content"))).toBe(true);
    await expect(page.locator("#content")).not.toHaveAttribute("tabindex");
  });

  // M24 (Samuel, 2026-10-14: "a hide sidebar toggle like in the Claude desktop app"): one button at the top
  // left hides the sidebar and shows it again, and the choice is remembered on this device across pages.
  test("the sidebar hides and comes back with the button at its top, and stays as left", async ({ page }) => {
    await page.goto("/");
    const hide = page.getByRole("button", { name: "Hide sidebar" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(aside(page)).toBeVisible();
    // A click that lands before the page's script has loaded does nothing; click again until it takes.
    await expect(async () => {
      await hide.click();
      await expect(aside(page)).toBeHidden({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    const show = page.getByRole("button", { name: "Show sidebar" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    // The page's title is not under the button.
    const button = (await show.boundingBox())!;
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    expect(title.x).toBeGreaterThanOrEqual(button.x + button.width);
    // Remembered: another page opens with the sidebar still hidden, with no flash of it.
    await page.goto("/paths");
    await expect(aside(page)).toBeHidden();
    await expect(async () => {
      await page.getByRole("button", { name: "Show sidebar" }).click();
      await expect(aside(page)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(sidebar(page).getByRole("link", { name: "Home" })).toBeVisible();
    await page.reload();
    await expect(aside(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide sidebar" })).toBeVisible();
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
    // Import is the fifth tab, last (M14 follow-up V3b; Samuel, #90).
    await expect(tabs.getByRole("link")).toHaveText(["Home", "Library", "Paths", "Search", "Import"]);
    // Five tabs fit a 390 px screen: each a finger-sized target (at least 44 x 44 px), side by side
    // inside the screen, with its icon and its whole label inside it.
    const fit = await tabs.getByRole("link").evaluateAll((links) =>
      links.map((a) => {
        const box = a.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(a);
        const inside = range.getBoundingClientRect();
        return { name: a.textContent, left: box.left, right: box.right, width: box.width, height: box.height, inLeft: inside.left, inRight: inside.right };
      }),
    );
    expect(fit).toHaveLength(5);
    for (const [i, t] of fit.entries()) {
      expect(t.width, `${t.name}: width`).toBeGreaterThanOrEqual(44);
      expect(t.height, `${t.name}: height`).toBeGreaterThanOrEqual(44);
      expect(t.left, `${t.name}: on the screen`).toBeGreaterThanOrEqual(0);
      expect(t.right, `${t.name}: on the screen`).toBeLessThanOrEqual(390);
      if (i > 0) expect(t.left, `${t.name}: beside the tab before it`).toBeGreaterThanOrEqual(fit[i - 1].right - 0.5);
      expect(t.inLeft, `${t.name}: label inside its tab`).toBeGreaterThanOrEqual(t.left);
      expect(t.inRight, `${t.name}: label inside its tab`).toBeLessThanOrEqual(t.right);
    }
    for (const [name, url, heading] of [
      ["Library", /\/library$/, "Your library"],
      ["Paths", /\/paths$/, "Your paths"],
      ["Search", /\/search$/, "Find a passage"],
      ["Import", /\/import$/, "Import"],
      ["Home", /:\d+\/$/, "Home"],
    ] as const) {
      await tabs.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(tabs.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
    // A Path page counts as the Paths tab.
    await page.goto("/paths/hidden-machinery");
    await expect(tabs.getByRole("link", { name: "Paths", exact: true })).toHaveAttribute("aria-current", "page");
    // The Import page with a book chosen for its audiobook (/import?book=…) counts as the Import tab.
    await page.goto("/import");
    await page.getByLabel("Book", { exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Choose", exact: true }).click();
    await expect(page).toHaveURL(/\/import\?book=[0-9a-f-]+#audio-h$/);
    await expect(tabs.getByRole("link", { name: "Import", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);

    // Scrolled to the end, the page's last line sits above the tab bar, not under it.
    await page.goto("/library");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastLine = page.getByText("Your library is yours:");
    const [lineBox, tabsBox] = [await lastLine.boundingBox(), await tabs.boundingBox()];
    expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(tabsBox!.y);
  });

  test("other pages start with their own title: no strip, no account button", async ({ page }) => {
    for (const path of ["/library", "/paths", "/search", "/data", "/account"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: /^Account: / })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Neolibrary", exact: true })).toBeHidden(); // the strip's name went with it
      // The page's own heading is the first thing in the page, at the top.
      const top = (await page.getByRole("main").getByRole("heading", { level: 1 }).boundingBox())!.y;
      expect(top).toBeLessThan(120);
    }
  });

  test("the account menu on Home opens a sheet from the bottom with the account links and Sign out, and closes", async ({ page }) => {
    const button = page.getByRole("button", { name: /^Account: / });
    const tabs = page.getByTestId("tab-bar");
    // Each colour scheme from a fresh page: switching on an open page measures colours mid-transition.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      // Beside Import, in Home's title row (Home's own Import, not the Import tab).
      const [importBox, buttonBox, titleBox] = [
        await page.getByRole("main").getByRole("link", { name: "Import", exact: true }).boundingBox(),
        await button.boundingBox(),
        await page.getByRole("heading", { level: 1, name: "Home" }).boundingBox(),
      ];
      expect(buttonBox!.x).toBeGreaterThan(importBox!.x);
      expect(Math.abs(buttonBox!.y + buttonBox!.height / 2 - (titleBox!.y + titleBox!.height / 2))).toBeLessThan(12);
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      const sheet = page.locator(`[id="${await button.getAttribute("aria-controls")}"]`);
      await expect(sheet.locator("p").first()).toHaveText(ADMIN.email);
      await expect(sheet.getByRole("link")).toHaveText(["Account", "Reading stats", "Your data", "Get help", "Invite"]);
      await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      // A sheet along the bottom of the screen, its rows sized for a thumb, over the tab bar.
      const sheetBox = (await sheet.boundingBox())!;
      expect(sheetBox.x).toBe(0);
      expect(sheetBox.width).toBe(390);
      expect(Math.abs(sheetBox.y + sheetBox.height - 844)).toBeLessThanOrEqual(1);
      for (const row of await sheet.getByRole("link").all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const tabBox = (await tabs.boundingBox())!;
      expect(await sheet.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x, y)), [tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2])).toBe(true);
      await page.screenshot({ path: `screenshots/account-menu-phone-${scheme}.png` });
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.any[0]?.message ?? ""})`).join("; ")}`)).toEqual([]);
    }
    // Escape closes it and gives focus back to the button.
    await page.getByRole("link", { name: "Your data", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();

    // A tap on the dimmed page closes it, and only that: the tap does not also open the link under the finger.
    await button.click();
    // Measured once the sheet has finished sliding up, and only links on the page: the sheet's own rows
    // are inside main too (CI run 38120118560 picked "Your data" mid-slide and tapped it).
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const sheetId = (await button.getAttribute("aria-controls"))!;
    const sheetTop = (await page.locator(`[id="${sheetId}"]`).boundingBox())!.y;
    const under = await page
      .getByRole("main")
      .getByRole("link")
      .evaluateAll(
        (links, [top, id]) => {
          for (const a of links) {
            if (a.closest(`[id="${id}"]`)) continue;
            const r = a.getBoundingClientRect();
            const y = r.top + r.height / 2;
            if (y > 120 && y < top - 8) return { x: r.left + r.width / 2, y };
          }
          return null;
        },
        [sheetTop, sheetId] as const,
      );
    expect(under, "a link on the page above the sheet").not.toBeNull();
    await page.evaluate(() =>
      document.addEventListener(
        "click",
        (e) => {
          Object.assign(window, { tapped: (e.target as Element).closest("a")?.getAttribute("href") ?? "no link" });
          e.preventDefault();
        },
        { capture: true, once: true },
      ),
    );
    await page.touchscreen.tap(under!.x, under!.y);
    await expect.poll(() => page.evaluate(() => (window as Window & { tapped?: string }).tapped)).toBe("no link");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(page).toHaveURL(/:\d+\/$/);

    // A link inside it opens its page (which has no account button); back on Home it is closed.
    await button.click();
    await page.getByRole("link", { name: "Your data", exact: true }).click();
    await expect(page).toHaveURL(/\/data$/);
    await expect(button).toHaveCount(0);
    await page.goBack();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

// M21: the command palette. Cmd+K (Ctrl+K on Windows and Linux) anywhere signed in, the reader included, opens a
// box that jumps to a book, a Path or its sections, a page, or a recent note, or searches the library.
test.describe("command palette", () => {
  // No service worker: requests then reach page.route, which keeps the reader's saves off the server (below).
  test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });

  const palette = (page: Page) => page.getByRole("dialog", { name: "Go to" });
  const box = (page: Page) => palette(page).getByRole("combobox", { name: "Go to a book, path, page or note" });
  type PaletteBook = { id: string; title: string; hasFile: boolean };
  const bookNamed = async (page: Page, title: RegExp) =>
    ((await (await page.request.get("/api/palette")).json()).books as PaletteBook[]).find((b) => title.test(b.title))!;

  test("jumps to a book, a page and a note with the keyboard; Escape closes it and gives focus back", async ({ page }) => {
    await page.goto("/library");
    await expect(palette(page)).toBeHidden();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();
    await expect(box(page)).toBeFocused();
    await expect(box(page)).toHaveAttribute("aria-expanded", "true");
    // Nothing typed: suggestions, the pages among them.
    await expect(palette(page).getByRole("listbox", { name: "Suggestions" }).getByRole("option", { name: /^Home/ })).toBeVisible();

    // Part of a book's title; the best match is highlighted and announced; Enter opens the book's page.
    await box(page).fill("time mach");
    const first = palette(page).getByRole("option").first();
    await expect(first).toContainText("The Time Machine");
    await expect(first).toContainText("Book");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(box(page)).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
    await expect(palette(page).getByRole("status")).toHaveText(/^\d+ results?, and Search the library\.$/);
    await expect(palette(page).getByRole("option").last()).toHaveText(/Search the library for “time mach”/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/books\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "The Time Machine" })).toBeVisible();
    await expect(palette(page)).toBeHidden();

    // A page: the arrows move the highlight (and wrap), Enter opens it.
    await page.keyboard.press("ControlOrMeta+k");
    await box(page).fill("agent acc");
    const options = palette(page).getByRole("option");
    await expect(options.first()).toContainText("Agent access");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.first()).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("ArrowUp");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByRole("heading", { level: 1, name: "Agent access" })).toBeVisible();

    // A note, by its words, opens the reader at its passage. The reader itself is not loaded here (a stand-in
    // page answers): later projects expect the books unopened. The note is removed again at the end.
    const book = await bookNamed(page, /^The Time Machine$/);
    const cfi = "epubcfi(/6/4!/4/2/1:0)";
    const note = (await (await page.request.post(`/api/books/${book.id}/annotations`, { data: { kind: "note", cfi, body: "Palette test: the Morlocks mind the machines." } })).json()) as { id: string };
    try {
      await page.route(/\/books\/[0-9a-f-]{36}\/read(\?|$)/, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reader</title><h1>Reader stand-in</h1>" }));
      await page.keyboard.press("ControlOrMeta+k");
      await box(page).fill("morlocks mind");
      await expect(options.first()).toContainText("Palette test: the Morlocks mind the machines.");
      await expect(options.first()).toContainText("The Time Machine");
      await expect(options.first()).toContainText("Note");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Reader stand-in" })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(`/books/${book.id}/read`);
      expect(new URL(page.url()).searchParams.get("at")).toBe(cfi);
      await page.unroute(/\/books\/[0-9a-f-]{36}\/read(\?|$)/);
    } finally {
      await page.request.delete(`/api/annotations/${note.id}`);
    }

    // Escape closes it and puts focus back where it was. Focus stays inside while it is open.
    await page.goto("/library");
    const filter = page.getByRole("searchbox", { name: "Filter by title or author" });
    await filter.focus();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(box(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(palette(page).getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(box(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await expect(filter).toBeFocused();
    // The same keys close it again; a click on the dimmed page closes it too.
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeHidden();
    await page.keyboard.press("ControlOrMeta+k");
    await page.mouse.click(10, 790);
    await expect(palette(page)).toBeHidden();
  });

  test("works in the reader, and its keys do not turn the page", async ({ page }) => {
    // Nothing the reader saves reaches the server here: the reader tests that follow expect the book unopened.
    await page.route(/\/api\/books\/[0-9a-f-]{36}\/(position|reading)$/, (route) => route.fulfill({ status: 200, json: {} }));
    const book = await bookNamed(page, /^The Strange Case/);
    await page.goto(`/books/${book.id}/read`);
    const reader = page.getByTestId("reader");
    await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    const before = await reader.getAttribute("data-cfi");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(box(page)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    expect(await reader.getAttribute("data-cfi")).toBe(before);
    // With focus inside the book's own page (a frame, in foliate's closed shadow root), the keys still open it,
    // and Escape puts focus back in the book.
    const inBook = () => page.evaluate(() => document.activeElement?.tagName === "FOLIATE-VIEW");
    await page.locator("foliate-view").click();
    await expect.poll(inBook).toBe(true);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();
    await expect(box(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await expect.poll(inBook).toBe(true);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(box(page)).toBeFocused();
    await box(page).fill("library");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/library$/);
  });

  test("is accessible, and looks right on phone and desktop, light and dark", async ({ page }) => {
    for (const [name, width, height] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
        await page.keyboard.press("ControlOrMeta+k");
        await box(page).fill("machin");
        await expect(palette(page).getByRole("option").first()).toBeVisible();
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${name} ${scheme} ${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.any[0]?.message ?? ""})`).join("; ")}`)).toEqual([]);
        await page.screenshot({ path: `screenshots/palette-${name}-${scheme}.png` });
        // The card stays inside the screen: no sideways scroll.
        const card = (await palette(page).locator("div").first().boundingBox())!;
        expect(card.x).toBeGreaterThanOrEqual(0);
        expect(card.x + card.width).toBeLessThanOrEqual(width);
      }
    }
  });
});

// M24 (Samuel, 2026-10-14: "a carousel for the books like how it is in Hark"), shown on the design page
// with sample books. It moves only when asked, and settles with one book in the middle, named in its pill.
test.describe("book carousel", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the arrows, a drag and Tab each settle a book in the middle; a drag opens nothing", async ({ page }) => {
    await page.goto("/design");
    const carousel = page.getByRole("region", { name: "Sample books" });
    const middle = carousel.locator("li[aria-current]");
    await carousel.scrollIntoViewIfNeeded();
    // It opens on its middle book (the 4th of 7), with books on both sides, not on its first.
    await expect(middle).toContainText("The Time Machine");
    const strip = (await carousel.locator("ul").boundingBox())!;
    const first = (await carousel.getByRole("link", { name: /^Meditations/ }).boundingBox())!;
    expect(first.x + first.width).toBeLessThan(strip.x + strip.width / 2); // a book sits left of the middle
    await expect(carousel.getByRole("button", { name: "Previous book" })).toBeEnabled();
    // The page's script may load after the first click; click again until the strip moves.
    await expect(async () => {
      await carousel.getByRole("button", { name: "Next book" }).click();
      await expect(middle).toContainText("Walden", { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    // The middle book's pill shows; a neighbour's does not.
    await expect(middle.getByText("Listen only")).toBeVisible();
    // Nothing moves on its own.
    await page.waitForTimeout(1_000);
    await expect(middle).toContainText("Walden");

    // A mouse drag to the left moves the strip on and opens no book.
    const box = (await carousel.locator("ul").boundingBox())!;
    const y = box.y + box.height / 3;
    await page.mouse.move(box.x + box.width / 2 + 150, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 250, y, { steps: 12 });
    await page.mouse.up();
    await expect(middle).not.toContainText("Walden");
    await expect(page).toHaveURL(/\/design(#carousel)?$/);

    // Tab onto a cover brings it to the middle.
    await carousel.getByRole("link", { name: /Middlemarch/ }).focus();
    await expect(middle).toContainText("Middlemarch");
    await expect(carousel.getByRole("button", { name: "Next book" })).toBeDisabled();
  });

  test("on a phone, the strip scrolls inside the page, never the page sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/design");
    const carousel = page.getByRole("region", { name: "Sample books" });
    await carousel.scrollIntoViewIfNeeded();
    expect((await carousel.boundingBox())!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

