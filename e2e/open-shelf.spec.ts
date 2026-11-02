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
    // No Listen, no selection menu: those need an account (S3).
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

    // S4 for visitors: the owner's saved answers on a free book are free to see; anything new needs the visitor's own
    // key; the owner's own marks never reach a visitor.
    const at = new URLSearchParams({ cfi: kept! });
    const owned = await (await page.request.get(`/api/books/${frankenstein}/prerequisites?${at}`)).json();
    expect((await page.request.post(`/api/books/${frankenstein}/prerequisites`, { data: { chapterId: owned.chapter.id } })).ok(), "owner asks Need to know").toBe(true);
    const qs = await (await page.request.get(`/api/books/${frankenstein}/questions?${at}`)).json();
    expect((await page.request.post(`/api/books/${frankenstein}/questions`, { data: { chapterId: qs.chapter.id } })).ok(), "owner makes a question bank").toBe(true);
    const banks = (await (await page.request.get(`/api/books/${frankenstein}/questions?${at}`)).json()) as { versions: { id: string; questions: { index: number }[] }[] };
    const bank = banks.versions.at(-1)!;
    const marked = await page.request.post(`/api/books/${frankenstein}/questions/marks`, { data: { generationId: bank.id, index: bank.questions[0].index, correct: false } });
    expect(marked.ok(), `owner marks a question: ${await marked.text()}`).toBe(true);
    const seen = await (await ctx.request.get(`/api/books/${frankenstein}/prerequisites?${at}`)).json();
    expect(seen.versions.length).toBeGreaterThan(0);
    expect(seen.estimate).toBeNull(); // no key: no price for a new answer
    const theirQs = await (await ctx.request.get(`/api/books/${frankenstein}/questions?${at}`)).json();
    expect(theirQs.versions.length).toBeGreaterThan(0);
    expect(theirQs.marks).toEqual({});
    const noKey = await ctx.request.post(`/api/books/${frankenstein}/prerequisites`, { data: { chapterId: seen.chapter.id, fresh: true } });
    expect(noKey.ok(), `a visitor's fresh request returns the saved answer: ${noKey.status()}`).toBe(true); // never a new paid answer
    expect((await noKey.json()).reused).toBe(true);
    // A paragraph with nothing saved (the Rewritten view): refused without a key, made with one, and marked as paid
    // with the visitor's own key; the answer never repeats the key.
    const onScreen = (await (await ctx.request.get(`/api/books/${frankenstein}/rewritten?${new URLSearchParams({ from: kept!, to: kept! })}`)).json()) as {
      pieces: { id: string; rewrite: unknown }[];
    };
    const fresh = onScreen.pieces.find((p) => !p.rewrite);
    expect(fresh, "a paragraph on screen with no saved rewrite").toBeTruthy();
    const without = await ctx.request.post(`/api/books/${frankenstein}/rewritten`, { data: { sectionId: fresh!.id } });
    expect(without.status()).toBe(503);
    expect((await without.json()).error).toContain("Add your own Anthropic key");
    const withKey = await ctx.request.post(`/api/books/${frankenstein}/rewritten`, {
      data: { sectionId: fresh!.id },
      headers: { "x-neolibrary-anthropic-key": "sk-ant-e2e-visitor-0042" },
    });
    expect(withKey.status()).toBe(201);
    const made = await withKey.text();
    expect(made).toContain("anthropic-own-key");
    expect(made).not.toContain("sk-ant-e2e-visitor-0042");
    // Only free books: another book's AI routes are closed to visitors.
    expect((await ctx.request.get(`/api/books/${timeMachine}/prerequisites?${at}`)).status()).toBe(401);
    expect((await ctx.request.get(`/api/books/${frankenstein}/ask`)).status()).toBe(401);

    // S5, the leak check: the owner's own note in the free book, and the owner's email and name, appear in nothing a
    // visitor can reach: the shelf, the book's page, the reader, the files' route and the three AI routes.
    const SECRET = `PRIVATE-NOTE-${Date.now()}`;
    const { hits } = await (await page.request.get(`/api/books/${frankenstein}/search?q=${encodeURIComponent("creature")}`)).json();
    const noted = await page.request.post(`/api/books/${frankenstein}/annotations`, {
      data: { kind: "highlight", cfi: hits[0].cfi, quote: { exact: "creature" }, color: "sage", body: SECRET },
    });
    expect(noted.ok(), "the owner notes a passage").toBe(true);
    const reachable = [
      `/browse`,
      `/browse?free=1`,
      `/browse/${frankenstein}`,
      `/browse/${frankenstein}/read`,
      `/api/books/${frankenstein}/prerequisites?${at}`,
      `/api/books/${frankenstein}/questions?${at}`,
      `/api/books/${frankenstein}/rewritten?${new URLSearchParams({ from: kept!, to: kept! })}`,
    ];
    for (const path of reachable) {
      const res = await ctx.request.get(path);
      expect(res.status(), path).toBe(200);
      const body = await res.text();
      for (const secret of [SECRET, "owner@example.com", "Samuel Example"]) expect(body.includes(secret), `${path} shows ${secret}`).toBe(false);
    }
    // The owner's notes, places and stats routes stay closed.
    for (const path of [`/api/books/${frankenstein}/annotations`, `/api/books/${frankenstein}/position`, `/api/books/${frankenstein}/reading`, "/api/me", "/api/export"]) {
      expect((await ctx.request.get(path)).status(), path).toBe(401);
    }

    // In the reader: a slim sidebar (Study and Rewritten), Study with two tabs, and the owner's saved answer shown.
    await visitor.getByRole("button", { name: "Sidebar" }).click();
    const rail = visitor.getByRole("navigation", { name: "Reading tools" });
    await expect(rail.getByRole("button")).toHaveCount(2);
    await rail.getByRole("button", { name: "Study" }).click();
    await expect(visitor.getByRole("tablist", { name: "Study" }).getByRole("tab")).toHaveText(["Need to know", "Test yourself"]);
    await expect(visitor.getByTestId("need-to-know")).toBeVisible();
    // Reading settings offer the visitor's own keys.
    await visitor.getByRole("button", { name: "Reading settings" }).click();
    await expect(visitor.getByTestId("own-keys")).toBeVisible();

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
