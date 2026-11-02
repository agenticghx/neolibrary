import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M34 S1 and S2 (docs/plan.md): the owner's two switches on a book's page, and the open shelf a visitor sees
// without signing in. Uses the three Standard Ebooks books uploads.spec.ts added to the owner's library, and
// only flips their switches (setting each back at the end), so it changes nothing another test counts.
test.use({ storageState: ADMIN_STATE });

const visitorContext = (browser: Browser) => browser.newContext({ storageState: { cookies: [], origins: [] } });

/** The owner's book id for a title, from the Library's search. */
async function bookId(page: Page, title: string) {
  await page.goto(`/library?q=${encodeURIComponent(title)}`);
  const href = await page.getByTestId("shelf").getByRole("link", { name: new RegExp(`^${title}`) }).first().getAttribute("href");
  const id = href?.match(/^\/books\/([0-9a-f-]{36})$/)?.[1];
  expect(id, `book id for ${title}`).toBeTruthy();
  return id!;
}

/** On the owner's book page, press one of the two Open shelf buttons and wait for it to say so. */
async function setSwitch(page: Page, id: string, label: "Anyone can see it" | "Anyone can read it", on: boolean) {
  await page.goto(`/books/${id}`);
  const button = page.getByTestId("open-shelf").getByRole("button", { name: label });
  if ((await button.getAttribute("aria-pressed")) !== String(on)) await button.click();
  await expect(button).toHaveAttribute("aria-pressed", String(on));
}

test("M34: a visitor sees the owner's shelf, the free book marked free, and Goodreads for the rest; a hidden book is not found", async ({ page, browser }) => {
  const frankenstein = await bookId(page, "Frankenstein");
  const timeMachine = await bookId(page, "The Time Machine");

  // The owner: every book starts on the shelf and not free to read; a Standard Ebooks edition may be made free.
  await page.goto(`/books/${timeMachine}`);
  const panel = page.getByTestId("open-shelf");
  await expect(panel.getByRole("button", { name: "Anyone can see it" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("button", { name: "Anyone can read it" })).toHaveAttribute("aria-pressed", "false");
  await setSwitch(page, frankenstein, "Anyone can read it", true);
  await expect(page.getByTestId("open-shelf")).toContainText("Visitors who are not signed in can open and read this book.");

  const ctx = await visitorContext(browser);
  const visitor = await ctx.newPage();
  try {
    // Opening the site lands on the shelf, not on sign-in.
    await visitor.goto("/");
    await expect(visitor).toHaveURL(/\/browse$/);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText("Samuel’s library");
    const grid = visitor.getByTestId("open-shelf-grid");
    await expect(grid.getByRole("link", { name: /^Frankenstein/ })).toContainText("Free to read");
    await expect(grid.getByRole("link", { name: /^The Time Machine/ })).not.toContainText("Free to read");

    // Free to read only.
    await visitor.getByRole("link", { name: "Free to read", exact: true }).click();
    await expect(visitor).toHaveURL(/\/browse\?free=1$/);
    await expect(grid.getByRole("link", { name: /^Frankenstein/ })).toBeVisible();
    await expect(grid.getByRole("link", { name: /^The Time Machine/ })).toHaveCount(0);

    // Covers come through the visitor's own links, and load.
    await visitor.goto("/browse");
    const cover = grid.getByRole("link", { name: /^Frankenstein/ }).locator("img");
    await expect(cover).toHaveAttribute("src", /^\/api\/open\/files\//);
    await expect.poll(() => cover.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const src = (await cover.getAttribute("src"))!;
    expect((await ctx.request.get(src.replace(/sig=[^&]+/, "sig=forged"))).status()).toBe(403);
    // A visitor link is no key to the signed-in route, and the book's own file is not handed out.
    expect((await ctx.request.get(src.replace("/api/open/files/", "/api/files/"))).status()).toBe(401);

    // A book that is not free: its page sends the visitor to Goodreads; its reader asks them to sign in.
    await visitor.goto(`/browse/${timeMachine}`);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText("The Time Machine");
    await expect(visitor.getByRole("link", { name: "Find it on Goodreads" })).toHaveAttribute(
      "href",
      "https://www.goodreads.com/search?q=The%20Time%20Machine%20H.%20G.%20Wells",
    );
    await visitor.goto(`/books/${timeMachine}/read`);
    await expect(visitor).toHaveURL(/\/sign-in\?next=/);

    // The free book's page says so.
    await visitor.goto(`/browse/${frankenstein}`);
    await expect(visitor.getByText("In the public domain", { exact: false })).toBeVisible();
    await expect(visitor.getByRole("link", { name: "Find it on Goodreads" })).toHaveCount(0);

    // S3: the visitor reads it. Nothing goes to the signed-in API; the place is kept in this browser.
    const calls: string[] = [];
    visitor.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith("/api/") && !path.startsWith("/api/open/files/")) calls.push(`${r.method()} ${path}`);
    });
    await visitor.getByRole("link", { name: "Read it free" }).click();
    await expect(visitor).toHaveURL(new RegExp(`/browse/${frankenstein}/read$`));
    const reader = visitor.getByTestId("reader");
    await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    // Only reading tools: no sidebar (notes, study, AI), no Listen.
    await expect(visitor.getByRole("button", { name: "Sidebar" })).toHaveCount(0);
    await expect(visitor.getByRole("button", { name: "Listen" })).toHaveCount(0);
    await expect(visitor.getByRole("button", { name: "Reading settings" })).toBeVisible();
    const start = await reader.getAttribute("data-cfi");
    for (let i = 0; i < 3; i++) await visitor.getByRole("button", { name: "Next page" }).click();
    await expect.poll(() => reader.getAttribute("data-cfi")).not.toBe(start);
    await expect.poll(() => visitor.evaluate((id) => localStorage.getItem(`neolibrary:visitor-place:${id}`), frankenstein)).toBeTruthy();
    const kept = await visitor.evaluate((id) => localStorage.getItem(`neolibrary:visitor-place:${id}`), frankenstein);
    await visitor.reload();
    await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    await expect(reader).toHaveAttribute("data-cfi", kept!);
    expect(calls).toEqual([]);
    await visitor.getByRole("link", { name: "Back to the shelf" }).click();
    await expect(visitor).toHaveURL(new RegExp(`/browse/${frankenstein}$`));

    // A book that is not free to read has no reader for visitors.
    expect((await visitor.goto(`/browse/${timeMachine}/read`))?.status()).toBe(404);

    // The owner takes a book off the shelf: it leaves the list, and its page is not found (not "sign in").
    await setSwitch(page, timeMachine, "Anyone can see it", false);
    await visitor.goto("/browse");
    await expect(grid.getByRole("link", { name: /^The Time Machine/ })).toHaveCount(0);
    expect((await visitor.goto(`/browse/${timeMachine}`))?.status()).toBe(404);
    // A made-up address is not found the same way.
    expect((await visitor.goto("/browse/00000000-0000-4000-8000-000000000000"))?.status()).toBe(404);

    // The owner's own notes and reading never reach the visitor's pages.
    await visitor.goto("/browse");
    await expect(visitor.getByText(/% read|highlights|Your notes/)).toHaveCount(0);
  } finally {
    await ctx.close();
    await setSwitch(page, timeMachine, "Anyone can see it", true);
    await setSwitch(page, frankenstein, "Anyone can read it", false);
  }
});

test("M34: the sign-in page offers the shelf", async ({ browser }) => {
  const ctx = await visitorContext(browser);
  const visitor = await ctx.newPage();
  await visitor.goto("/sign-in");
  await visitor.getByRole("link", { name: "browse the shelf" }).click();
  await expect(visitor).toHaveURL(/\/browse$/);
  await expect(visitor.getByRole("link", { name: "Sign in" })).toBeVisible();
  await ctx.close();
});
