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

async function openAtPhrase(page: Page, phrase: string, book: RegExp = /The Strange Case/) {
  await page.goto(`/search?q=${encodeURIComponent(`"${phrase}"`)}`);
  await page.getByRole("region", { name: book }).getByRole("link").filter({ hasText: phrase.split(" ")[0] }).first().click();
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
      // Plain English follows Samuel's plain-english skill (M17); the other levels have an instruction file each.
      promptName: v.options.level === "plain" ? "plain-rewrite + plain/SKILL" : `rewrite + rewrite-levels/${v.options.level}`,
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

test("STE rewrites: a strictness dial, a full-STE score badge and the meaning-change notes", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary");
  await openRewrite(page, "lover of the sane and customary");
  await expect(panel(page)).toContainText("Version 3 of 3");
  const dial = panel(page).getByRole("group", { name: "STE strictness" });
  await expect(dial.getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");
  await dial.getByRole("button", { name: "Strict" }).click();
  await panel(page).getByRole("button", { name: "STE", exact: true }).click();
  await expect(rewrite(page)).toContainText("Rewrite · STE, Strict · written by the test AI");
  await expect(rewrite(page)).toContainText(/STE \d+% \(full-STE score\)/);
  await expect(rewrite(page)).toContainText("Meaning changes");
  await expect(rewrite(page).getByRole("listitem")).toHaveText(["The test AI chose no meanings; this note shows where real ones go."]);
  await expect(rewrite(page)).not.toContainText("---notes---");
  await expect(panel(page)).toContainText("Version 4 of 4");

  // A percentage picks the level (75% is Standard) and, with STE showing, asks for it.
  await dial.getByLabel("or a percentage").fill("75");
  await expect(rewrite(page)).toContainText("Rewrite · STE, Standard");
  await expect(panel(page)).toContainText("Version 5 of 5");
  await expect(dial.getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");
  // Back to Strict: the stored version is re-served.
  await dial.getByRole("button", { name: "Strict" }).click();
  await expect(rewrite(page)).toContainText("Rewrite · STE, Strict");
  await expect(panel(page)).toContainText("Version 4 of 5");

  const url = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/rewrites?")));
  const data = await (await page.request.get(url!)).json();
  const ste = data.versions.filter((v: { options: { level: string } }) => v.options.level === "ste");
  expect(ste.map((v: { options: { strictness: string } }) => v.options.strictness)).toEqual(["strict", "standard"]);
  for (const v of ste) {
    expect(v.ste.score).toBeGreaterThanOrEqual(0);
    expect(v.ste.score).toBeLessThanOrEqual(100);
    expect(v.provenance.promptName).toBe("ste-rewrite + ste/SKILL + ste/substitutions");
  }
  const bad = await page.request.post(`/api/books/${bookIdOf(page)}/rewrites`, {
    data: { sectionId: data.paragraph.id, level: "ste", strictness: "very" },
  });
  expect(bad.status()).toBe(400);
});

test('"What do I need to know?" explains the chapter\'s assumed concepts once, and keeps the answer', async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary");
  const know = page.getByRole("region", { name: "What do I need to know?" });
  const box = page.getByTestId("need-to-know");
  await page.getByRole("button", { name: "What do I need to know?" }).click();
  await expect(know).toContainText("Search for Mr. Hyde");
  await know.getByRole("button", { name: /^Show me \((about \$|under \$)/ }).click();
  await expect(box).toContainText("Before you read · written by the test AI");
  await expect(box.locator("dt").first()).toBeVisible();
  const links = box.getByRole("link", { name: /^Read more about/ });
  expect(await links.count()).toBeGreaterThan(0);
  await expect(links.first()).toHaveAttribute("href", /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?search=/);
  await expect(links.first()).toHaveAttribute("target", "_blank");
  await expect(box).toContainText(/fake · \d+ \w+ \d{4} · \$0\.\d+/);

  // Closing and reopening shows the stored answer; nothing is asked again.
  await page.getByRole("button", { name: "What do I need to know?" }).click();
  await expect(know).toHaveCount(0);
  await page.getByRole("button", { name: "What do I need to know?" }).click();
  await expect(know).toContainText("Saved answer");
  await know.getByRole("button", { name: "Try again" }).click();
  await expect(know).toContainText("Latest of 2 answers");

  // Another chapter has its own answer.
  await page.getByRole("button", { name: "What do I need to know?" }).click();
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "The Carew Murder Case" }).click();
  await expect(page.locator("footer")).toContainText("The Carew Murder Case");
  await page.getByRole("button", { name: "What do I need to know?" }).click();
  await expect(know).toContainText("The Carew Murder Case");
  await expect(know.getByRole("button", { name: /^Show me/ })).toBeVisible();
});

test("STE as a reading preference: set for all books in reading settings, or for one book", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary");
  const settings = page.getByRole("region", { name: "Reading settings" });
  const style = settings.getByRole("group", { name: "AI explanations" });
  const know = page.getByRole("region", { name: "What do I need to know?" });
  const box = page.getByTestId("need-to-know");

  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(style.getByRole("button", { name: "Plain" })).toHaveAttribute("aria-pressed", "true");
  await style.getByRole("button", { name: "STE strict" }).click();
  await expect(style.getByRole("button", { name: "STE strict" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "What do I need to know?" }).click();
  await expect(know).toContainText("Search for Mr. Hyde · STE, Strict (full STE)");
  await know.getByRole("button", { name: /^Show me/ }).click();
  await expect(box).toContainText(/STE \d+% \(full-STE score\)/);
  await expect(know).toContainText("Saved answer");

  // This book only: plain English again; the two earlier plain answers come back, free.
  await page.getByRole("button", { name: "Reading settings" }).click();
  await style.getByLabel("Only for this book").check();
  await style.getByRole("button", { name: "Plain" }).click();
  await expect(style.getByRole("button", { name: "Plain" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "What do I need to know?" }).click();
  await expect(know).toContainText("Search for Mr. Hyde · Plain English");
  await expect(know).toContainText("Latest of 2 answers");
  await expect(box).not.toContainText("full-STE score");

  // Following the setting for all books again: STE strict, after a reload too.
  await page.getByRole("button", { name: "Reading settings" }).click();
  await style.getByLabel("Only for this book").uncheck();
  await expect(style.getByRole("button", { name: "STE strict" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const styles = await (await page.request.get(`/api/books/${bookIdOf(page)}/ai-style`)).json();
  expect(styles).toEqual({ user: "ste-strict", book: null, effective: "ste-strict" });
  expect((await page.request.put(`/api/books/${bookIdOf(page)}/ai-style`, { data: { scope: "all", style: "loud" } })).status()).toBe(400);
});

test("question bank: answers hidden until asked, marks kept, and wrong answers flag the chapter for a re-read", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary");
  const test = page.getByRole("region", { name: "Test yourself" });
  const list = page.getByTestId("questions");
  const score = page.getByTestId("question-score");
  await page.getByRole("button", { name: "What do I need to know?" }).click();
  await page.getByRole("button", { name: "Test yourself on this chapter ›" }).click();
  await expect(test).toContainText("Search for Mr. Hyde · STE, Strict (full STE)"); // the reading preference from the last test
  await test.getByRole("button", { name: /^Make questions \((about|under) \$/ }).click();
  await expect(list).toContainText("Question bank · written by the test AI");
  const items = list.locator("li");
  await expect(items).toHaveCount(9);
  await expect(items.nth(0)).toContainText("Recall");
  await expect(items.nth(8)).toContainText("Application");
  await expect(list).toContainText(/STE \d+% \(full-STE score\)/);
  await expect(score).toHaveText("0 right · 0 wrong · 9 to go");
  await expect(items.nth(0)).not.toContainText("A made-up model answer");

  await items.nth(0).getByRole("button", { name: "Show answer" }).click();
  await expect(items.nth(0)).toContainText("A made-up model answer");
  await items.nth(0).getByRole("button", { name: "I got it wrong" }).click();
  await expect(score).toHaveText("0 right · 1 wrong · 8 to go");
  await items.nth(3).getByRole("button", { name: "Show answer" }).click();
  await items.nth(3).getByRole("button", { name: "I got it right" }).click();
  await expect(score).toHaveText("1 right · 1 wrong · 7 to go");

  // Marks survive a reload; answers are hidden again.
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "What do I need to know?" }).click();
  await page.getByRole("button", { name: "Test yourself on this chapter ›" }).click();
  await expect(score).toHaveText("1 right · 1 wrong · 7 to go");
  await expect(test).toContainText("Saved questions");
  await expect(items.nth(0)).not.toContainText("A made-up model answer");

  // The book page lists the chapter under "Needs a re-read"; the link opens it.
  const id = bookIdOf(page);
  await page.goto(`/books/${id}`);
  const reread = page.getByRole("region", { name: "Needs a re-read" });
  await expect(reread).toContainText("Search for Mr. Hyde · 1 of 2 wrong");
  await reread.getByRole("link", { name: "Search for Mr. Hyde" }).click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.locator("footer")).toContainText("Search for Mr. Hyde");

  const bad = await page.request.post(`/api/books/${id}/questions/marks`, { data: { generationId: "nope", index: 0, correct: true } });
  expect(bad.status()).toBe(400);
});

test("cross-book links: a page that shares ideas with a note in another book says so, and links there", async ({ page }) => {
  // A note in Frankenstein about a will, a lawyer and a safe…
  await openAtPhrase(page, "You will rejoice to hear", /Frankenstein/);
  const frankenstein = bookIdOf(page);
  await selectPhrase(page, "You will rejoice to hear");
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  await bar.getByRole("button", { name: "Add note" }).click();
  await bar.getByLabel("Your note").fill("A will, a lawyer and a locked safe, as with Utterson.");
  await bar.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes (1)");

  // …is linked from the Jekyll page where Utterson, a lawyer, opens his safe and reads the will.
  await openAtPhrase(page, "lover of the sane and customary");
  const button = page.getByRole("button", { name: "1 link to your other books" });
  await expect(button).toBeVisible();
  await button.click();
  const panel = page.getByRole("region", { name: "Elsewhere in your library" });
  const item = page.getByTestId("crosslinks").locator("li");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Frankenstein");
  await expect(item).toContainText("“You will rejoice to hear”");
  await expect(item).toContainText("A will, a lawyer and a locked safe, as with Utterson.");
  await panel.getByRole("link", { name: "Open in Frankenstein" }).click();
  // A link within the app (reading aloud goes on): the other book's reader replaces this one once its address is shown.
  await expect(page).toHaveURL(new RegExp(`/books/${frankenstein}/read`));
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  expect(bookIdOf(page)).toBe(frankenstein);
  const text = await page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    return view.renderer.getContents().map(({ doc }) => doc.body.textContent).join(" ");
  });
  expect(text).toContain("You will rejoice to hear");

  // Text with nothing in common links to nothing; a note is never linked from its own book.
  const none = await page.request.post(`/api/books/${frankenstein}/crosslinks`, { data: { text: "Engines, gears and the price of steel." } });
  expect((await none.json()).links).toEqual([]);
  const own = await page.request.post(`/api/books/${frankenstein}/crosslinks`, { data: { text: "Utterson the lawyer opened his safe." } });
  expect((await own.json()).links.map((l: { bookId: string }) => l.bookId)).not.toContain(frankenstein);
});

// M17, read it rewritten (docs/rewritten-view-plan.md): the page on screen, rewritten in the book's
// AI explanations style (STE strict here, left by the reading-preference test above), beside the page or alone.
const pane = (page: Page) => page.getByRole("region", { name: "Rewritten" });
const show = (page: Page) => pane(page).getByRole("group", { name: "Show" });

/** Counts the rewrites the page asks the server to make (each one is paid). */
function countMade(page: Page) {
  const made = { n: 0 };
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/books\/[0-9a-f-]{36}\/rewritten$/.test(r.url())) made.n++;
  });
  return made;
}

/**
 * Turns back one page and waits for it. foliate ignores a turn asked for while the last one finishes,
 * so the click is repeated only while the page has not moved (never past the page wanted).
 */
async function turnBack(page: Page, to: string | RegExp) {
  const from = await reader(page).getAttribute("data-cfi");
  await expect(async () => {
    if ((await reader(page).getAttribute("data-cfi")) === from) await page.getByRole("button", { name: "Previous page" }).click();
    await expect(reader(page)).toHaveAttribute("data-cfi", to, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

/** Turns on one page, and waits until the rewritten view has asked about the new page. */
async function turnOn(page: Page) {
  const from = (await reader(page).getAttribute("data-cfi"))!;
  const asked = page.waitForResponse((r) => r.url().includes("/rewritten?") && r.request().method() === "GET");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(reader(page)).not.toHaveAttribute("data-cfi", from);
  await asked;
}

test("read it rewritten: beside the page, made once at the price shown, kept across page turns, or alone instead of the page", async ({ page }) => {
  const made = countMade(page);
  await openAtPhrase(page, "London was startled by a crime of singular ferocity");
  await expect(pane(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Rewritten view" }).click();
  await expect(page.getByRole("button", { name: "Rewritten view" })).toHaveAttribute("aria-pressed", "true");
  await expect(show(page).getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
  await expect(pane(page)).toContainText("Rewritten · STE strict");
  const ask = pane(page).getByRole("button", { name: "Rewrite this page in STE strict" });
  await expect(ask).toBeVisible();
  await expect(pane(page)).toContainText(/It costs (about \$\d+\.\d\d|under \$0\.01), once\. Saved rewrites are free\./);
  const missing = await pane(page).getByTestId("rewritten-missing").count();
  expect(missing).toBeGreaterThan(0);
  // Beside the page on a computer: the book is still on screen, to its left.
  const book = await page.locator("foliate-view").boundingBox();
  const side = await pane(page).boundingBox();
  expect(side!.x).toBeGreaterThanOrEqual(book!.x + book!.width);
  expect(made.n).toBe(0);

  await ask.click();
  const pieces = pane(page).getByTestId("rewritten-piece");
  await expect(pieces).toHaveCount(missing);
  await expect(ask).toHaveCount(0);
  await expect(pieces.first()).toContainText("STE strict · written by the test AI");
  await expect(pieces.first()).toContainText("Fake rewrite (ste, strict (full ste)): ");
  await expect(pieces.first()).toContainText(/STE \d+% \(full-STE score\)/);
  await expect(pieces.first()).toContainText("1 meaning choice");
  await expect(pieces.first()).toContainText(/fake · \d+ \w+ \d{4} · \$\d/);
  expect(made.n).toBe(missing);

  // Turn on and back: the page's saved rewrites show again, with no second call.
  const here = (await reader(page).getAttribute("data-cfi"))!;
  await turnOn(page);
  await turnBack(page, here);
  await expect(pieces).toHaveCount(missing);
  await expect(pane(page).getByRole("button", { name: /^Rewrite this page/ })).toHaveCount(0);
  expect(made.n).toBe(missing);

  // The rewrite alone: over the page, which stays open under it (its turns still work, its text is out of reach).
  await show(page).getByRole("button", { name: "Rewritten" }).click();
  await expect(show(page).getByRole("button", { name: "Rewritten" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("foliate-view").locator("xpath=..")).toHaveAttribute("inert", "");
  // It covers the whole page, which keeps its size (not pushed aside), with the turn arrows either side.
  const over = (await pane(page).boundingBox())!;
  const under = (await page.locator("foliate-view").boundingBox())!;
  expect(under.width).toBeGreaterThan(600);
  expect(over.x).toBeLessThanOrEqual(under.x + 1);
  expect(over.x + over.width).toBeGreaterThanOrEqual(under.x + under.width - 1);
  const next = (await page.getByRole("button", { name: "Next page" }).boundingBox())!;
  const prev = (await page.getByRole("button", { name: "Previous page" }).boundingBox())!;
  expect(next.x).toBeGreaterThanOrEqual(over.x + over.width - 1);
  expect(prev.x + prev.width).toBeLessThanOrEqual(over.x + 1);
  expect(Math.abs(next.y - prev.y)).toBeLessThan(2);
  await expect(pieces).toHaveCount(missing);
  await turnOn(page);
  // A paragraph not rewritten yet shows the book's own words, labelled, until it is.
  await expect(pane(page).getByTestId("rewritten-original").or(pieces).first()).toBeVisible();
  expect(made.n).toBe(missing);

  // Remembered on this device; Original closes it, and that is remembered too.
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(show(page).getByRole("button", { name: "Rewritten" })).toHaveAttribute("aria-pressed", "true");
  await show(page).getByRole("button", { name: "Original" }).click();
  await expect(pane(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rewritten view" })).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(pane(page)).toHaveCount(0);
  // The button goes back to the last view that showed the rewrite.
  await page.getByRole("button", { name: "Rewritten view" }).click();
  await expect(show(page).getByRole("button", { name: "Rewritten" })).toHaveAttribute("aria-pressed", "true");
});

test("read it rewritten in a PDF: each page on screen, and the style from reading settings", async ({ page }) => {
  const made = countMade(page);
  // The PDF made by reader.spec.ts, at its first page (found by search: the book itself was left on page 3).
  await openAtPhrase(page, "Good sense is", /Discourse on the Method/);
  await expect(reader(page)).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/2/);
  // Each test has a new browser: nothing remembered, so the button opens Side by side.
  await page.getByRole("button", { name: "Rewritten view" }).click();
  await expect(show(page).getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
  await pane(page).getByRole("button", { name: "Rewrite this page in STE strict" }).click();
  const pieces = pane(page).getByTestId("rewritten-piece");
  await expect(pieces.first()).toContainText("Fake rewrite (ste, strict (full ste)): ");
  await expect(pane(page)).toContainText("Good sense is");
  await mkdir("screenshots", { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/reader-rewritten-pdf-side-desktop-light.png" });
  const first = made.n;
  expect(first).toBeGreaterThan(0);

  await turnOn(page);
  await expect(reader(page)).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/4/);
  await expect(pane(page).getByTestId("rewritten-missing").first()).toContainText("The diversity of our opinions");
  await turnBack(page, /^epubcfi\(\/6\/2/);
  await expect(pieces.first()).toContainText("Good sense is");
  expect(made.n).toBe(first);

  // Plain English for this book only: the pane follows, and offers a Plain rewrite.
  await page.getByRole("button", { name: "Reading settings" }).click();
  const style = page.getByRole("region", { name: "Reading settings" }).getByRole("group", { name: "AI explanations" });
  await style.getByLabel("Only for this book").check();
  await style.getByRole("button", { name: "Plain" }).click();
  await expect(pane(page)).toContainText("Rewritten · Plain");
  await expect(pane(page).getByRole("button", { name: "Rewrite this page in Plain" })).toBeVisible();
  // Back to the setting for all books (STE strict), as the later tests expect.
  await style.getByLabel("Only for this book").uncheck();
  await expect(pane(page)).toContainText("Rewritten · STE strict");
  await expect(pieces.first()).toContainText("Good sense is");
  expect(made.n).toBe(first);
});

test("the rewritten view is accessible, and looks right beside the page and alone, on phone and desktop, light and dark", async ({ page }) => {
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await openAtPhrase(page, "London was startled by a crime of singular ferocity");
      // Opened once; remembered by this browser for the other looks.
      if (!(await page.getByRole("button", { name: "Rewritten view" }).getAttribute("aria-pressed"))?.includes("true")) {
        await page.getByRole("button", { name: "Rewritten view" }).click();
      }
      await expect(pane(page).getByTestId("rewritten-piece").first()).toBeVisible();
      for (const mode of ["Side by side", "Rewritten"] as const) {
        await show(page).getByRole("button", { name: mode }).click();
        await expect(show(page).getByRole("button", { name: mode })).toHaveAttribute("aria-pressed", "true");
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join(" | ")}`)).toEqual([]);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `screenshots/reader-rewritten-${mode === "Rewritten" ? "alone" : "side"}-${name}-${scheme}.png` });
      }
      await show(page).getByRole("button", { name: "Side by side" }).click();
    }
  }
  await show(page).getByRole("button", { name: "Original" }).click();
  await expect(pane(page)).toHaveCount(0);
});

test("the AI and cross-book panels are accessible, and look right on phone and desktop, light and dark", async ({ page }) => {
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

      await page.getByRole("button", { name: "What do I need to know?" }).click();
      await expect(page.getByTestId("need-to-know")).toBeVisible();
      const know = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(know.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join(" | ")}`)).toEqual([]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-need-to-know-${name}-${scheme}.png` });

      await page.getByRole("button", { name: "Reading settings" }).click();
      await expect(page.getByRole("group", { name: "AI explanations" })).toBeVisible();
      const set = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(set.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/reader-settings-${name}-${scheme}.png` });

      await page.getByRole("button", { name: "What do I need to know?" }).click();
      await page.getByRole("button", { name: "Test yourself on this chapter ›" }).click();
      await page.getByTestId("questions").locator("li").nth(1).getByRole("button", { name: "Show answer" }).click();
      const qs = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(qs.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/reader-questions-${name}-${scheme}.png` });

      await page.getByRole("button", { name: "1 link to your other books" }).click();
      await expect(page.getByTestId("crosslinks")).toBeVisible();
      const cl = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(cl.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/reader-crosslinks-${name}-${scheme}.png` });
    }
  }
});
