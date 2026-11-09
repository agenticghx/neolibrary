import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { parseEpub } from "../lib/library/ebook";
import { genealogyPromptHash, type SentLink } from "../lib/library/genealogy-store";
import { extractSections } from "../lib/library/sections";
import { ADMIN_STATE } from "./pages";

// The reading tools (Notes, Study, Rewritten view, Bookmark, Focus session) live in the reader's sidebar
// (app/(reader)/books/[id]/read/sidebar.ts, Samuel 2026-11-01); these tests start with it open.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("neolibrary:reader-sidebar", "open");
    } catch {
      // A page that keeps nothing starts with the sidebar closed.
    }
  });
});

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

  await panel(page).getByRole("button", { name: "Plain", exact: true }).click();
  await expect(rewrite(page)).toContainText("Rewrite · Plain · written by the test AI");
  await expect(rewrite(page)).toContainText("Fake rewrite (plain english): ");
  await expect(rewrite(page)).toContainText(/fake · \d+ \w+ \d{4} · \$0\.\d+/);
  await expect(panel(page)).toContainText("Version 1 of 1");
  // M21: the reading level of the paragraph and of its rewrite (Flesch-Kincaid grade), the same numbers seen and heard.
  // The fake rewrite is the paragraph's first two sentences, so it need not be easier: only the shape is checked.
  const level = rewrite(page).getByTestId("readability");
  const shown = level.locator('summary [data-part="shown"]');
  await expect(shown).toHaveText(/^Grade \d+\s+\d+$/); // the arrow between them is drawn
  await expect(shown.locator("svg")).toBeVisible();
  await expect(level).toContainText(/Reading level: original grade \d+, this rewrite grade \d+/);
  const seen = /Grade (\d+)\s+(\d+)/.exec((await shown.textContent())!)!;
  await expect(level.locator("summary .visually-hidden")).toHaveText(`Reading level: original grade ${seen[1]}, this rewrite grade ${seen[2]}`);
  const note = level.getByText("It counts sentence and word length only, not meaning.", { exact: false });
  await expect(note).toBeHidden();
  await level.locator("summary").click();
  await expect(note).toBeVisible();

  await panel(page).getByRole("button", { name: "Shorter" }).click();
  await expect(rewrite(page)).toContainText("Rewrite · Shorter");
  await expect(panel(page)).toContainText("Version 2 of 2");
  await panel(page).getByRole("button", { name: "Earlier version" }).click();
  await expect(rewrite(page)).toContainText("Rewrite · Plain ·");

  // Asking for Plain again re-serves the stored version: no new version, no second call.
  await panel(page).getByRole("button", { name: "Plain", exact: true }).click();
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

// M19 P5: the Light / Standard / Strict dial became three of the four styles (STE light, STE, STE strict), the
// names Aa and the Account page use. The percentage box stays.
test("STE rewrites: STE light, STE and STE strict, a full-STE score badge and the meaning-change notes", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary");
  await openRewrite(page, "lover of the sane and customary");
  await expect(panel(page)).toContainText("Version 3 of 3");
  const dial = panel(page).getByRole("group", { name: "Rewrite as" });
  await expect(dial.getByRole("button")).toHaveText(["Plain", "STE light", "STE", "STE strict"]);
  await dial.getByRole("button", { name: "STE strict" }).click();
  await expect(rewrite(page)).toContainText("Rewrite · STE strict · written by the test AI");
  await expect(dial.getByRole("button", { name: "STE strict" })).toHaveAttribute("aria-pressed", "true");
  await expect(rewrite(page)).toContainText(/STE \d+% \(full-STE score\)/);
  await expect(rewrite(page)).toContainText("Meaning changes");
  await expect(rewrite(page).getByRole("listitem")).toHaveText(["The test AI chose no meanings; this note shows where real ones go."]);
  await expect(rewrite(page)).not.toContainText("---notes---");
  await expect(panel(page)).toContainText("Version 4 of 4");

  // A percentage picks the strictness (75% is STE, the standard one) and, with STE showing, asks for it.
  await dial.getByLabel("or a percentage").fill("75");
  await expect(rewrite(page)).toContainText("Rewrite · STE · written by the test AI");
  await expect(panel(page)).toContainText("Version 5 of 5");
  await expect(dial.getByRole("button", { name: "STE", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Back to STE strict: the stored version is re-served.
  await dial.getByRole("button", { name: "STE strict" }).click();
  await expect(rewrite(page)).toContainText("Rewrite · STE strict");
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
  await page.getByRole("button", { name: "Study" }).click();
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
  await page.getByRole("button", { name: "Study" }).click();
  await expect(know).toHaveCount(0);
  await page.getByRole("button", { name: "Study" }).click();
  await expect(know).toContainText("Saved answer");
  await know.getByRole("button", { name: "Try again" }).click();
  await expect(know).toContainText("Latest of 2 answers");

  // Another chapter has its own answer.
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "The Carew Murder Case" }).click();
  await expect(page.locator("footer")).toContainText("The Carew Murder Case");
  await page.getByRole("button", { name: "Study" }).click();
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

  await page.getByRole("button", { name: "Study" }).click();
  await expect(know).toContainText("Search for Mr. Hyde · STE strict");
  await know.getByRole("button", { name: /^Show me/ }).click();
  await expect(box).toContainText(/STE \d+% \(full-STE score\)/);
  await expect(know).toContainText("Saved answer");

  // This book only: plain English again; the two earlier plain answers come back, free.
  await page.getByRole("button", { name: "Reading settings" }).click();
  await style.getByLabel("Only for this book").check();
  await style.getByRole("button", { name: "Plain" }).click();
  await expect(style.getByRole("button", { name: "Plain" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Study" }).click();
  await expect(know).toContainText("Search for Mr. Hyde · Plain");
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

// M19 P5 (the site review's fifth finding): one Study button, whose panel has two tabs, so Test yourself is no longer
// behind a link; and the Rewrite panel offers the same four style names as Aa and the Account page, with the other
// ways under "More ways".
test("Study opens on Need to know, with Test yourself one tab away; Rewrite offers the four styles first", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary");
  await expect(page.getByRole("button", { name: "What do I need to know?" })).toHaveCount(0); // the "?" is gone
  await page.getByRole("button", { name: "Study" }).click();
  const tabs = page.getByRole("tablist", { name: "Study" });
  await expect(tabs.getByRole("tab")).toHaveText(["Need to know", "Test yourself", "Ask", "Explain it back", "Who & what", "Genealogy"]);
  await expect(tabs.getByRole("tab", { name: "Need to know" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "What do I need to know?" })).toBeVisible();
  await tabs.getByRole("tab", { name: "Test yourself" }).click();
  await expect(page.getByRole("region", { name: "Test yourself" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Test yourself" })).toHaveAttribute("aria-selected", "true");
  // The arrow keys move between the tabs.
  await tabs.getByRole("tab", { name: "Test yourself" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("region", { name: "What do I need to know?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "What do I need to know?" })).toHaveCount(0);

  await openRewrite(page, "lover of the sane and customary");
  await expect(panel(page).getByRole("group", { name: "Rewrite as" }).getByRole("button")).toHaveText(["Plain", "STE light", "STE", "STE strict"]);
  await expect(panel(page).getByRole("group", { name: "More ways" }).getByRole("button")).toHaveText([
    "For a biologist",
    "Add missing background",
    "Shorter",
  ]);
  // Reading settings names the styles the same way, and no longer needs a note to tell the two sets apart.
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByRole("group", { name: "AI explanations" }).getByRole("button")).toContainText(["Plain", "STE light", "STE", "STE strict"]);
  await expect(page.getByRole("region", { name: "Reading settings" })).not.toContainText("still offers every level");
});

test("question bank: answers hidden until asked, marks kept, and wrong answers flag the chapter for a re-read", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary");
  const test = page.getByRole("region", { name: "Test yourself" });
  const list = page.getByTestId("questions");
  const score = page.getByTestId("question-score");
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tab", { name: "Test yourself" }).click();
  await expect(test).toContainText("Search for Mr. Hyde · STE strict"); // the reading preference from the last test
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
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tab", { name: "Test yourself" }).click();
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

/** Shows the rewrite beside the page, whatever view the account was left in. */
async function openSide(page: Page) {
  const button = page.getByRole("button", { name: "Rewritten view" });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await show(page).getByRole("button", { name: "Side by side" }).click();
  await expect(show(page).getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
}

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

/**
 * Turns on one page, and waits until the rewritten view has asked about the new page. As in turnBack, the click is
 * repeated only while the page has not moved: a turn asked for while the book is laid out again (switching to the
 * rewrite alone widens it) is dropped (CI run 41340351516, #256, the click 30 ms after the switch).
 */
async function turnOn(page: Page) {
  const from = (await reader(page).getAttribute("data-cfi"))!;
  const asked = page.waitForResponse((r) => r.url().includes("/rewritten?") && r.request().method() === "GET");
  await expect(async () => {
    if ((await reader(page).getAttribute("data-cfi")) === from) await page.getByRole("button", { name: "Next page" }).click();
    await expect(reader(page)).not.toHaveAttribute("data-cfi", from, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
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
  await expect(pane(page)).toContainText(/It costs (about \$\d+\.\d\d|under \$0\.01), once; saved rewrites are free\. Then each page you turn to is rewritten too, until you press Stop, and it asks again after every \$1\./);
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
  // M21: each rewritten paragraph carries its reading-level badge too.
  await expect(pieces.first().getByTestId("readability")).toContainText(/Reading level: original grade \d+, this rewrite grade \d+/);
  await expect(pieces.getByTestId("readability")).toHaveCount(missing);
  expect(made.n).toBe(missing);
  // Stop rewriting as you turn (the next test covers it): from here on, only what is saved shows.
  await pane(page).getByTestId("as-you-turn").getByRole("button", { name: "Stop" }).click();
  await expect(pane(page).getByTestId("as-you-turn")).toHaveCount(0);

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

  // Saved on the account (every book and device opens in it); Original closes it, and that is saved too.
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(show(page).getByRole("button", { name: "Rewritten" })).toHaveAttribute("aria-pressed", "true");
  await show(page).getByRole("button", { name: "Original" }).click();
  await expect(pane(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rewritten view" })).toHaveAttribute("aria-pressed", "false");
  // The button goes back to the last view that showed the rewrite.
  await page.getByRole("button", { name: "Rewritten view" }).click();
  await expect(show(page).getByRole("button", { name: "Rewritten" })).toHaveAttribute("aria-pressed", "true");
  await show(page).getByRole("button", { name: "Original" }).click();
  await expect.poll(async () => (await (await page.request.get("/api/account/preferences")).json()).rewrittenView).toBe("original");
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(pane(page)).toHaveCount(0);
});

test("read it rewritten in a PDF: each page on screen, and the style from reading settings", async ({ page }) => {
  const made = countMade(page);
  // The PDF made by reader.spec.ts, at its first page (found by search: the book itself was left on page 3).
  await openAtPhrase(page, "Good sense is", /Discourse on the Method/);
  await expect(reader(page)).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/2/);
  // The last test left the account on Original: the button opens Side by side.
  await page.getByRole("button", { name: "Rewritten view" }).click();
  await expect(show(page).getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
  await pane(page).getByRole("button", { name: "Rewrite this page in STE strict" }).click();
  const pieces = pane(page).getByTestId("rewritten-piece");
  await expect(pieces.first()).toContainText("Fake rewrite (ste, strict (full ste)): ");
  await expect(pane(page)).toContainText("Good sense is");
  await pane(page).getByTestId("as-you-turn").getByRole("button", { name: "Stop" }).click();
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

// R3: after one press, each page turned to is rewritten too, with a running total; after $1 since the last
// go-ahead it asks first (as Listen does since #133). Each paragraph made is billed $0.60 here (the fake's real cost
// is a fraction of a cent): the client's rule is what is tested, with the server's answers otherwise unchanged.
test("read it rewritten as you turn: made without a click after the first press, with a total, asking again after $1", async ({ page }) => {
  const made = countMade(page);
  await page.route(/\/api\/books\/[0-9a-f-]{36}\/rewritten$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    return route.fulfill({ response: res, json: { ...body, reused: false, generation: { ...body.generation, provenance: { ...body.generation.provenance, costUsd: 0.6 } } } });
  });
  await openAtPhrase(page, "It was late in the afternoon");
  await openSide(page);
  await pane(page).getByRole("button", { name: "Rewrite this page in STE strict" }).click();
  const line = pane(page).getByTestId("as-you-turn");
  // One or two paragraphs at once, depending on how many the first page holds.
  await expect(line).toContainText(/So far: (1 paragraph rewritten, about \$0\.60|2 paragraphs rewritten, about \$1\.20)\./);
  const question = line.getByText(/^Keep rewriting\?/);

  // Turn on until it asks: no clicks besides the turns, and it stops after the second paragraph ($1.20 since the go-ahead).
  for (let i = 0; i < 6 && !(await question.isVisible()); i++) {
    await turnOn(page);
    await expect.poll(async () => (await question.isVisible()) || (await pane(page).getByTestId("rewritten-missing").count()) === 0).toBe(true);
  }
  await expect(question).toHaveText(/^Keep rewriting\? This page costs (about \$\d+\.\d\d|under \$0\.01)\. So far: 2 paragraphs rewritten, about \$1\.20\.$/);
  expect(made.n).toBe(2);
  await page.waitForTimeout(1000);
  expect(made.n).toBe(2);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await mkdir("screenshots", { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `screenshots/reader-rewritten-keep-going-desktop-${scheme}.png` });
  }

  // Keep rewriting: it goes on, and the total with it.
  await line.getByRole("button", { name: "Keep rewriting" }).click();
  await expect.poll(() => made.n).toBeGreaterThan(2);
  await expect(line).toContainText(/So far: [3-9] paragraphs rewritten/);

  // Closing the view and opening it again keeps it on; Stop turns it off, and a turn then makes nothing.
  await show(page).getByRole("button", { name: "Original" }).click();
  await page.getByRole("button", { name: "Rewritten view" }).click();
  await expect(line).toContainText("So far:");
  await expect.poll(async () => (await line.getByText(/^Writing/).count()) === 0).toBe(true);
  await line.getByRole("button", { name: "Stop" }).click();
  await expect(line).toHaveCount(0);
  const before = made.n;
  await turnOn(page);
  await page.waitForTimeout(500);
  expect(made.n).toBe(before);

  // Never remembered: after a reload it is off until asked again.
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(pane(page)).toBeVisible();
  await expect(line).toHaveCount(0);
});

// Samuel (2026-10-10): books open side by side in STE light, and both are reading preferences on the Account page,
// the same settings the reader's own switches change. (New readers' defaults: lib/library/preferences.test.ts.)
test("reading preferences on the Account page: the view a book opens with and the style, shared with the reader", async ({ page }) => {
  const card = page.getByRole("region", { name: "Reading preferences" });
  const opensWith = card.getByRole("group", { name: "A book opens with" });
  const style = card.getByRole("group", { name: "AI explanations" });
  const before = await (await page.request.get("/api/account/preferences")).json();
  await page.goto("/account");
  await opensWith.getByRole("button", { name: "Rewritten" }).click();
  await style.getByRole("button", { name: "STE light" }).click();
  await expect(opensWith.getByRole("button", { name: "Rewritten" })).toHaveAttribute("aria-pressed", "true");
  await expect(style.getByRole("button", { name: "STE light" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await page.request.get("/api/account/preferences")).json()).toEqual({ aiStyle: "ste-light", rewrittenView: "rewritten" });

  // A book opens that way, in that style.
  await openAtPhrase(page, "London was startled by a crime of singular ferocity");
  await expect(show(page).getByRole("button", { name: "Rewritten" })).toHaveAttribute("aria-pressed", "true");
  await expect(pane(page)).toContainText("Rewritten · STE light");

  // The reader's switch is the same setting.
  await show(page).getByRole("button", { name: "Side by side" }).click();
  await page.goto("/account");
  await expect(opensWith.getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/account-reading-preferences-desktop-light.png", fullPage: true });

  // Refused: what the app does not know. Then back as the earlier tests left it, for the tests after this one.
  expect((await page.request.put("/api/account/preferences", { data: { rewrittenView: "sideways" } })).status()).toBe(400);
  expect((await page.request.put("/api/account/preferences", { data: before })).ok()).toBe(true);
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

// M32 X1: Who & what, the X-ray index found in the book's own text: the names most mentioned so far first, each
// with a trail of chapters. The list knows where the reader is: a name first met in a later chapter is not listed
// until the reader gets there, inside the reader (the saved position moves, and the list follows).
test("Who & what lists the book's names by mentions so far, and a name met later appears once the reader gets there", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary"); // chapter 2, Search for Mr. Hyde
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Who & what" }).click();
  const who = page.getByRole("region", { name: "Who & what" });
  await expect(who).toBeVisible();
  const list = who.getByTestId("xray-list");
  // At the top of chapter 2 the first chapter's names lead: Utterson, Enfield and Hyde, in that chapter's counts.
  await expect(list).toContainText("Mr. Utterson");
  await expect(list).toContainText("Mr. Enfield"); // the way the book most often writes him
  await expect(list).toContainText("Edward Hyde");
  await expect(list).not.toContainText("Sir Danvers Carew"); // first met in chapter 4, The Carew Murder Case
  await expect(who).toContainText(/\d+ of \d+ names, met so far/);
  // Everything, including what is ahead.
  const everything = who.getByLabel("Show everything, including what is ahead");
  await everything.check();
  await expect(list).toContainText("Sir Danvers Carew");
  await everything.uncheck();
  await expect(list).not.toContainText("Sir Danvers Carew");
  // Find a name (one the reader has met: London is named in chapter 1; Soho not before the end of chapter 2).
  await who.getByLabel("Find a name").fill("london");
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list).toContainText("London");
  await who.getByLabel("Find a name").fill("soho");
  await expect(who).toContainText("No name like that.");
  await who.getByLabel("Find a name").fill("");
  // The reader moves on to the murder, in the reader: the list follows.
  const xray = await (await page.request.get(`/api/books/${bookIdOf(page)}/xray`)).json();
  const carew = xray.entries.find((e: { aliases: string[] }) => e.aliases.includes("Carew"));
  await page.evaluate((cfi) => (document.querySelector("foliate-view") as unknown as { goTo(cfi: string): Promise<void> }).goTo(cfi), carew.chapters[0].cfi);
  await expect(list).toContainText("Sir Danvers Carew", { timeout: 10_000 });
  // By chapter 4 the lawyer has been named far more often than anyone: he leads.
  await expect(list.getByRole("button").first()).toContainText("Mr. Utterson");
  // A name opened: where it appears, each chapter a link to its first mention there.
  await list.getByRole("button", { name: /Mr\. Utterson/ }).click();
  const card = who.getByTestId("xray-card");
  await expect(card).toContainText("Mr. Utterson");
  await expect(card).toContainText("Also written Utterson");
  await expect(card).toContainText("Where it appears");
  await card.getByRole("button", { name: /Search for Mr\. Hyde/ }).click();
  await page.waitForFunction(
    () => (document.querySelector("foliate-view") as unknown as { lastLocation?: { tocItem?: { label?: string } } }).lastLocation?.tocItem?.label === "Search for Mr. Hyde",
  );
  await card.getByRole("button", { name: "Back to the list" }).click();
  await expect(list).toBeVisible();
  // A place that is not in the book is refused.
  expect((await page.request.get(`/api/books/${bookIdOf(page)}/xray?cfi=nonsense`)).status()).toBe(400);
});

/** A tap on the first X-ray underline of the page, through foliate's own hit test on the page's document. */
async function tapFirstMark(page: Page) {
  type Contents = { doc: Document; overlayer?: { element: SVGElement } }[];
  await page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): Contents } };
    for (const { doc, overlayer } of view.renderer.getContents()) {
      const line = overlayer?.element.querySelector("g[data-xray] line");
      if (!line) continue;
      const x = (Number(line.getAttribute("x1")) + Number(line.getAttribute("x2"))) / 2;
      const y = Number(line.getAttribute("y1")) - 5;
      doc.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }));
      return;
    }
    throw new Error("no mark on this page");
  });
}

// M43 S3: the Genealogy tab. The book's links are sent as the laptop skill sends them (with an owner token, quotes
// anchored to real paragraphs of the Jekyll fixture; no model is called), then each of the seven views opens over
// the page, the slider hides what is ahead of the reader, and a quote turns the page to where the book says it.
test("Genealogy opens its three questions and seven views over the page, from where the reader is", async ({ page, playwright }) => {
  await openAtPhrase(page, "lover of the sane and customary"); // Search for Mr. Hyde: chapter 2 of the views' numbering
  const bookId = bookIdOf(page);
  const bytes = new Uint8Array(readFileSync("fixtures/books/stevenson-jekyll-and-hyde.epub"));
  const paras = extractSections(bytes, parseEpub(bytes).toc as { label: string; href: string }[]).filter((x) => x.kind === "paragraph");
  const at = (quote: string) => {
    const p = paras.find((x) => x.text.includes(quote));
    if (!p) throw new Error(`not in the book: ${quote}`);
    return { paragraph: p.id, quote };
  };
  const link = (from: string, fromKind: "person" | "organisation", relation: string, to: string, toKind: "person" | "organisation", quote: string, extra: Partial<SentLink> = {}): SentLink => ({
    from,
    from_kind: fromKind,
    to,
    to_kind: toKind,
    relation,
    role: null,
    ...at(quote),
    check: "holds",
    ...extra,
  });
  const links: SentLink[] = [
    link("Hastie Lanyon", "person", "friend", "Henry Jekyll", "person", "you and I must be the two oldest friends that Henry Jekyll has"), // ch 2
    link("Gabriel John Utterson", "person", "friend", "Henry Jekyll", "person", "you and I must be the two oldest friends that Henry Jekyll has"), // ch 2
    link("Gabriel John Utterson", "person", "advised", "Henry Jekyll", "person", "though he took charge of it now that it was made", { role: "lawyer" }), // ch 2
    link("Poole", "person", "worked_at", "Dr. Jekyll's house", "organisation", "“I will see, Mr. Utterson,” said Poole", { role: "butler" }), // ch 2
    link("Dr. Jekyll's house", "organisation", "acquired", "The surgeon's dissecting rooms", "organisation", "The doctor had bought the house from the heirs of a celebrated surgeon"), // ch 5
    link("Gabriel John Utterson", "person", "advised", "Sir Danvers Carew", "person", "Carew was my client, but so are you", { role: "lawyer", check: "fix", was: "Utterson worked for Carew", why: "The lawyer advised him." }), // ch 5
    link("The cabinet", "organisation", "part_of", "Dr. Jekyll's house", "organisation", "now more than ever confined himself to the cabinet over the laboratory"), // ch 6
    link("Poole", "person", "family", "Henry Jekyll", "person", "“Is Dr. Jekyll at home, Poole?” asked the lawyer.", { removed: true, check: null, why: "A butler, not family." }),
  ];
  const lives = {
    "Gabriel John Utterson": [
      { what: "friend", with: "Henry Jekyll", links: [1], basis: "ordered" as const, why: "Their friendship is old when the book begins.", gk: { start_year: 1860, end_year: null, confidence: "medium" as const, note: "A test year, standing in for general knowledge." } },
      { what: "advised", with: "Henry Jekyll", links: [2], basis: "ordered" as const, why: "He holds the will in chapter 2." },
      { what: "advised", with: "Sir Danvers Carew", links: [5], basis: "ordered" as const, order: at("Carew was my client, but so are you"), why: "Carew was his client before the murder." },
    ],
  };

  // The laptop skill's part: a token, and the send.
  await page.goto("/agents");
  await page.getByLabel("Which agent is it for?").fill("Genealogy");
  await page.getByRole("button", { name: "Make a token" }).click();
  const token = await page.getByTestId("new-token").inputValue();
  const agent = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const sent = await agent.post(`/api/agent/books/${bookId}/genealogy`, { data: { model: "claude-sonnet-5-5", promptHash: await genealogyPromptHash(), links, lives } });
  expect(sent.status(), await sent.text()).toBeLessThan(300);
  expect(await sent.json()).toMatchObject({ links: 7, removed: 1, events: 3, dropped: {} });
  // A second book's genealogy naming the lawyer by his surname alone, for "Also in" below.
  const frankenstein = ((await (await agent.get("/api/agent/books")).json()).books as { id: string; title: string }[]).find((b) => b.title === "Frankenstein")!;
  const fBytes = new Uint8Array(readFileSync("fixtures/books/shelley-frankenstein.epub"));
  const fPara = extractSections(fBytes, parseEpub(fBytes).toc as { label: string; href: string }[]).find((x) => x.kind === "paragraph" && x.text.length > 200)!;
  const fSent = await agent.post(`/api/agent/books/${frankenstein.id}/genealogy`, {
    data: { model: "claude-sonnet-5-5", promptHash: await genealogyPromptHash(), links: [{ from: "Utterson", from_kind: "person", to: "Victor Frankenstein", to_kind: "person", relation: "friend", paragraph: fPara.id, quote: fPara.text.split(" ").slice(0, 8).join(" "), check: "holds" }], lives: {} },
  });
  expect(fSent.status(), await fSent.text()).toBeLessThan(300);
  await agent.dispose();

  await openAtPhrase(page, "lover of the sane and customary");
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Genealogy" }).click();
  const tab = page.getByRole("region", { name: "Genealogy" });
  await expect(tab.getByTestId("genealogy-summary")).toContainText("7 links between 8 people and organisations, 1 life put in order");
  await expect(tab).toContainText("You are in chapter 2 of");

  // Family tree: at chapter 2 the house has no parent or offspring yet; slid to the end, it has both.
  await tab.getByRole("button", { name: /^Family tree/ }).click();
  const g = page.getByRole("dialog", { name: "Genealogy" });
  await expect(g).toBeVisible();
  const slider = g.getByRole("slider", { name: "Read up to chapter" });
  await expect(slider).toHaveValue("2");
  await expect(g.getByTestId("genealogy")).toContainText("Up to chapter 2, the book has not yet linked Dr. Jekyll's house to another organisation.");
  const end = await slider.getAttribute("max");
  await slider.fill(end!);
  // The tree's cards: each names the organisation and how it is linked (the picker's chips name it alone).
  await expect(g.getByRole("button", { name: "The surgeon's dissecting rooms bought" })).toBeVisible();
  await expect(g.getByRole("button", { name: "The cabinet part of it" })).toBeVisible();
  await g.getByRole("button", { name: "The surgeon's dissecting rooms bought" }).click();
  const drawer = g.getByRole("dialog", { name: "Where the book says it" });
  await expect(drawer).toContainText("The doctor had bought the house from the heirs of a celebrated surgeon");
  await expect(drawer).toContainText("Chapter 5: Incident of the Letter");
  await page.keyboard.press("Escape"); // the drawer first
  await expect(drawer).toBeHidden();
  await expect(g).toBeVisible();
  await g.getByRole("button", { name: "Back to where I am" }).click();
  await expect(slider).toHaveValue("2");

  // Inside a company: its three drawings, at the reader's chapter (the purchase is ahead, so only Poole so far).
  await g.getByRole("group", { name: "View" }).getByRole("button", { name: "Inside a company" }).click();
  await expect(g.getByRole("img", { name: "Power map of Dr. Jekyll's house" })).toBeVisible();
  await expect(g).toContainText("1 name, 1 link, up to chapter 2");
  await g.getByRole("button", { name: "Money and parts" }).click();
  await expect(g.getByRole("button", { name: /^Poole/ })).toBeVisible();
  await g.getByRole("button", { name: "Who was there when" }).click();
  await expect(g.getByRole("img", { name: "Who was linked to Dr. Jekyll's house, chapter by chapter" })).toBeVisible();
  await expect(g.locator("svg text", { hasText: "not read yet" })).toBeVisible();

  // One person: the lawyer's life, in the order it happened (the Carew step is ahead until the slider moves).
  await g.getByRole("group", { name: "View" }).getByRole("button", { name: "One person" }).click();
  await g.getByLabel("Find a name").fill("Gabriel John Utterson");
  await g.getByLabel("Find a name").press("Enter"); // the picker opens a name on its change event
  await slider.fill(end!);
  await expect(g.getByRole("img", { name: "Gabriel John Utterson's life as a storyline" })).toBeVisible();
  await expect(g.locator("svg text", { hasText: "1860" })).toBeVisible(); // a general-knowledge year, in purple
  await g.getByRole("button", { name: "Read vs happened" }).click();
  await expect(g.getByRole("img", { name: "Where the book tells each step against when it happened" })).toBeVisible();
  await g.getByRole("button", { name: "List" }).click();
  await expect(g.locator("ol li")).toHaveCount(3);
  // Years the book leaves out: the purple year goes when they are left blank.
  await expect(g.getByText("1860", { exact: true })).toBeVisible();
  await g.getByRole("button", { name: "Leave blank" }).click();
  await expect(g.getByText("1860", { exact: true })).toHaveCount(0);
  await g.getByRole("button", { name: "Fill from general knowledge" }).click();
  // Who gets rebuilt: above his three links, his life is shown in the book's order, and he can be rebuilt anyway.
  await g.getByRole("button", { name: "5 times" }).click();
  await expect(g).toContainText("below your setting of 5, so this is the book's order");
  await g.getByRole("button", { name: "Rebuild Gabriel John Utterson anyway" }).click();
  await expect(g).toContainText("3 life events, in the order they happened");
  // The links the second reading removed are listed apart.
  await expect(g.getByText("Links the second reading removed (1)")).toBeVisible();

  // A step's sentences: the general-knowledge year is labelled as such, and the quote turns the page.
  await g.getByRole("button", { name: "where the book says it, and how it was placed" }).last().click();
  await expect(drawer).toContainText("Carew was my client, but so are you");
  await expect(drawer).toContainText("corrected");
  await drawer.getByRole("button", { name: "Go to this place in the book" }).first().click();
  await expect(g).toHaveCount(0);
  await page.waitForFunction(
    () => (document.querySelector("foliate-view") as unknown as { lastLocation?: { tocItem?: { label?: string } } }).lastLocation?.tocItem?.label === "Incident of the Letter",
  );

  // From a name in Who & what: the lawyer's card offers his life, under his genealogy name, and opens it.
  await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Who & what" }).click();
  const who = page.getByRole("region", { name: "Who & what" });
  await who.getByTestId("xray-list").getByRole("button", { name: /Mr\. Utterson/ }).click();
  const fromCard = who.getByTestId("xray-genealogy");
  await expect(fromCard).toContainText("In the genealogy as Gabriel John Utterson.");
  await fromCard.getByRole("button", { name: "Life, in the order it happened" }).click();
  await expect(g.getByRole("img", { name: "Gabriel John Utterson's life as a storyline" })).toBeVisible();
  await page.screenshot({ path: "screenshots/genealogy-from-xray-desktop-light.png" });
  await g.getByRole("button", { name: "Close", exact: true }).click();
  // A name the genealogy does not have (London, a place) offers nothing.
  await who.getByTestId("xray-card").getByRole("button", { name: "Back to the list" }).click();
  await who.getByTestId("xray-list").getByRole("button", { name: /^London/ }).click();
  await expect(who.getByTestId("xray-card")).toContainText("Where it appears");
  await expect(who.getByTestId("xray-genealogy")).toHaveCount(0);

  // Screenshots for the pull request (not committed), at desktop and phone size, light and dark.
  await mkdir("screenshots", { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [name, size] of [
      ["desktop", { width: 1280, height: 860 }],
      ["phone", { width: 390, height: 844 }],
    ] as const) {
      await page.setViewportSize(size);
      await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Genealogy" }).click().catch(() => undefined);
      if (!(await tab.isVisible())) {
        await page.getByRole("button", { name: "Study" }).click();
        await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Genealogy" }).click();
      }
      await page.screenshot({ path: `screenshots/genealogy-tab-${name}-${scheme}.png` });
      for (const [question, file] of [
        ["Family tree", "tree"],
        ["Inside a company", "org"],
        ["One person", "person"],
      ] as const) {
        await tab.getByRole("button", { name: new RegExp(`^${question}`) }).click();
        await g.getByRole("slider", { name: "Read up to chapter" }).fill(end!);
        await page.waitForTimeout(150); // the tree's and ribbons' lines are drawn on the next frame
        await page.screenshot({ path: `screenshots/genealogy-${file}-${name}-${scheme}.png` });
        await g.getByRole("button", { name: "Close", exact: true }).click();
      }
    }
  }
  await page.emulateMedia({ colorScheme: "light" });

  // "Also in <book>": the lawyer is in Frankenstein's genealogy too (as "Utterson"); the link opens that book's views on him.
  await page.setViewportSize({ width: 1280, height: 860 });
  await tab.getByRole("button", { name: /^One person/ }).click();
  await g.getByLabel("Find a name").fill("Gabriel John Utterson");
  await g.getByLabel("Find a name").press("Enter");
  const also = g.getByTestId("genealogy-also");
  await expect(also).toContainText("Also in");
  await expect(also.getByRole("link", { name: /Frankenstein/ })).toContainText("as Utterson · 1 link");
  await page.screenshot({ path: "screenshots/genealogy-also-desktop-light.png" });
  await also.getByRole("link", { name: /Frankenstein/ }).click();
  await page.waitForURL(new RegExp(`/books/${frankenstein.id}/read\\?genealogy=person`));
  const there = page.getByRole("dialog", { name: "Genealogy" });
  await expect(there.getByTestId("genealogy")).toContainText("Frankenstein: genealogy");
  await expect(there.getByRole("img", { name: "Utterson's life as a storyline" })).toBeVisible();
  // And back: Frankenstein's Utterson is in Jekyll and Hyde as Gabriel John Utterson.
  await expect(there.getByTestId("genealogy-also").getByRole("link", { name: /Jekyll/ })).toContainText("as Gabriel John Utterson");
});

// M32 X2: names on the page. Each name's first mention in a paragraph carries a dotted underline, drawn on foliate's
// overlay; a tap on an underline opens the card over the page, which knows where the reader is like the Who & what
// list. The names on the screen are listed under "On this page" at the top of Who & what, opened from the sidebar's
// Names button when wanted: never over the text (Samuel, 2026-11-08: the strip at the foot of the page sometimes hid the reading).
test("names on the page carry a dotted underline, a tap opens the card, and Names in the sidebar lists the names on this page", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary"); // chapter 2, Search for Mr. Hyde
  await expect(page.getByRole("region", { name: "On this page" }), "nothing over the page until asked for").toHaveCount(0);
  await page.getByRole("navigation", { name: "Reading tools" }).getByRole("button", { name: "Names", exact: true }).click();
  const who = page.getByRole("region", { name: "Who & what" });
  const strip = who.getByRole("region", { name: "On this page" });
  await expect(strip).toContainText("Mr. Utterson");
  await expect(strip).toContainText("Edward Hyde");
  // A name on this page opens in the panel.
  const card = page.getByTestId("xray-card");
  await strip.getByRole("button", { name: "Edward Hyde" }).click();
  await expect(card).toContainText("Edward Hyde");
  await expect(card).toContainText("Also written Mr. Hyde, Hyde");
  await card.getByRole("button", { name: "Back to the list" }).click();
  await expect(strip).toBeVisible();
  // The sidebar button closes it again.
  await page.getByRole("navigation", { name: "Reading tools" }).getByRole("button", { name: "Names", exact: true }).click();
  await expect(who).toHaveCount(0);
  // Underlines on the overlay of the chapter shown (foliate keeps the overlay's SVG beside the page's frame, and
  // hands it out with the frame's document): one per name per paragraph.
  type Contents = { doc: Document; overlayer?: { element: SVGElement } }[];
  const drawn = await page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): Contents } };
    return view.renderer.getContents().reduce((n, { overlayer }) => n + (overlayer?.element.querySelectorAll("g[data-xray]").length ?? 0), 0);
  });
  expect(drawn).toBeGreaterThan(5);
  // A tap on the first underline (Mr. Utterson, the chapter's first words) opens the card over the page.
  await tapFirstMark(page);
  await expect(card).toContainText("Mr. Utterson");
  await expect(card).toContainText("Where it appears");
  await expect(card).toContainText("mentions so far");
  await card.getByRole("button", { name: "Close" }).click();
  await expect(card).toHaveCount(0);
  // "All names" opens Who & what; Escape closes it.
  await tapFirstMark(page);
  await card.getByRole("button", { name: "All names" }).click();
  await expect(card).toHaveCount(0);
  await expect(who).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(who).toHaveCount(0);
  // The marks endpoint wants a chapter number.
  expect((await page.request.get(`/api/books/${bookIdOf(page)}/xray/marks?chapter=x`)).status()).toBe(400);
});

// M32 X3: Build the X-ray reads the whole book with Claude (the test AI here), chapter by chapter, behind an estimate
// and a confirm box. Facts carry the quote they rest on; a fact whose quote is not in the book is dropped and counted
// (the test AI plants one per chapter). A card shows what the book has said up to where the reader is; a quote opens
// its place in the book.
test("Build the X-ray reads the book with the AI, drops the planted facts, and a card shows what the book has said up to here", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary"); // chapter 2, Search for Mr. Hyde
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Who & what" }).click();
  const who = page.getByRole("region", { name: "Who & what" });
  const build = who.getByRole("region", { name: "Read the book with Claude" });
  await expect(build).toContainText("0 of 10 chapters read");
  const agree = build.getByLabel(/I understand this reads 10 chapters with the test AI and costs (about \$|under \$)/);
  await expect(build.getByRole("button", { name: "Build the X-ray" })).toBeDisabled();
  expect((await page.request.post(`/api/books/${bookIdOf(page)}/xray/build`, { data: { confirm: "yes" } })).status()).toBe(400);
  await agree.check();
  await build.getByRole("button", { name: "Build the X-ray" }).click();
  await expect(build).toContainText("10 of 10 chapters read", { timeout: 30_000 });
  await expect(build.getByRole("status")).toContainText("Every chapter is read. 10 facts were left out: their quotes were not in the book.");
  await expect(build).toContainText(/\d+ facts/);
  // The list now knows kinds, and the planted name has no place in the book.
  const list = who.getByTestId("xray-list");
  await expect(list).toContainText("Person");
  await who.getByLabel("Show everything, including what is ahead").check();
  await expect(list).not.toContainText("Green Cheese");
  await who.getByLabel("Show everything, including what is ahead").uncheck();
  // The lawyer's card: facts from chapter 1 (read), the rest ahead; each quote is the book's own words.
  await list.getByRole("button", { name: /Mr\. Utterson/ }).click();
  const facts = who.getByTestId("xray-facts");
  await expect(facts).toContainText("Written by the test AI, from the book’s words");
  await expect(facts).toContainText("The test AI says this chapter names Mr. Utterson here.");
  await expect(facts).toContainText("“Mr. Utterson the lawyer was a man of”"); // the test AI quotes a passage's first eight words
  await expect(who.getByTestId("xray-card")).toContainText(/\d+ more ahead/);
  await expect(facts).toContainText(/fake · \d+ \w+ \d{4}/);
  // A quote opens its place: the first chapter.
  await facts.getByRole("button", { name: /Mr\. Utterson the lawyer was a man/ }).click();
  await page.waitForFunction(
    () => (document.querySelector("foliate-view") as unknown as { lastLocation?: { tocItem?: { label?: string } } }).lastLocation?.tocItem?.label === "Story of the Door",
  );
  // The ten AI answers count as spending on this book, under the caps.
  const summary = await (await page.request.get(`/api/books/${bookIdOf(page)}/xray/build`)).json();
  expect(summary.done).toBe(10);
  expect(summary.caps.spentBookUsd).toBeGreaterThan(0);
  expect(summary.caps.spentBookUsd).toBeLessThanOrEqual(summary.caps.perBookUsd);
});

// M32 X4: a card's two outer layers. "From your library": the same name in the reader's other books, with a link into
// each. "From the world": what is generally known of the name, asked for on the card, labelled as AI and as from
// outside the book, stored once asked. Always below what the book itself says.
test("a card shows the same name in your other books with a link, and asks the AI what the world knows, once", async ({ page }) => {
  await openAtPhrase(page, "lover of the sane and customary"); // chapter 2; London was named in chapter 1
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Who & what" }).click();
  const who = page.getByRole("region", { name: "Who & what" });
  await who.getByLabel("Find a name").fill("london");
  await who.getByTestId("xray-list").getByRole("button", { name: /London/ }).click();
  const card = who.getByTestId("xray-card");
  await expect(card).toContainText("From your library");
  const library = card.getByTestId("xray-library");
  await expect(library).toContainText("Frankenstein");
  await expect(library).toContainText(/\d+ mentions?/);
  await expect(library.getByRole("link", { name: "Open in Frankenstein" })).toHaveAttribute("href", /\/books\/[0-9a-f-]{36}\/read\?at=epubcfi/);
  // The world's layer comes last, on request, and is kept.
  await expect(card.getByTestId("xray-world")).toHaveCount(0);
  await card.getByRole("button", { name: /What is generally known \((about \$|under \$)/ }).click();
  const world = card.getByTestId("xray-world");
  await expect(world).toContainText("Written by the test AI from general knowledge, not from the book");
  await expect(world).toContainText("The test AI's general knowledge of London");
  await expect(world).toContainText(/fake · \d+ \w+ \d{4} · \$0\.\d+/);
  // Opened again: the stored note, no button.
  await card.getByRole("button", { name: "Back to the list" }).click();
  await who.getByTestId("xray-list").getByRole("button", { name: /London/ }).click();
  await expect(card.getByTestId("xray-world")).toContainText("The test AI's general knowledge of London");
  await expect(card.getByRole("button", { name: /What is generally known/ })).toHaveCount(0);
  // A name that is nowhere else says so; the layers refuse a name that is not in this book.
  await card.getByRole("button", { name: "Back to the list" }).click();
  await who.getByLabel("Find a name").fill("utterson");
  await who.getByTestId("xray-list").getByRole("button", { name: /Mr\. Utterson/ }).click();
  await expect(card).toContainText("Nothing in your other books.");
  expect((await page.request.get(`/api/books/${bookIdOf(page)}/xray/entry?entry=x-000000000000`)).status()).toBe(404);
  expect((await page.request.get(`/api/books/${bookIdOf(page)}/xray/entry?entry=nonsense`)).status()).toBe(400);
});

test("the AI and cross-book panels are accessible, and look right on phone and desktop, light and dark", async ({ page }) => {
  // Four looks of six panels, each with an accessibility check: 15 to 22 s on CI, so the default 30 s ran out on a
  // slow runner (CI run 39445509504). The same budget as the other four-look tests.
  test.setTimeout(120_000);
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

      // M21: the reading-level badge, opened to show its note.
      const level = rewrite(page).getByTestId("readability");
      await level.locator("summary").click();
      await expect(level.getByText("not meaning", { exact: false })).toBeVisible();
      await level.scrollIntoViewIfNeeded();
      const lv = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(lv.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join(" | ")}`)).toEqual([]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/rewrite-readability-${name}-${scheme}.png` });

      await page.getByRole("button", { name: "Study" }).click();
      await expect(page.getByTestId("need-to-know")).toBeVisible();
      const know = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(know.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join(" | ")}`)).toEqual([]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-need-to-know-${name}-${scheme}.png` });

      // M32 X1: Who & what, the names found in the book's text.
      await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Who & what" }).click();
      await expect(page.getByTestId("xray-list")).toBeVisible();
      const who = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(who.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join(" | ")}`)).toEqual([]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-who-and-what-${name}-${scheme}.png` });

      // M32 X2: the card that opens from a name on the page.
      await page.keyboard.press("Escape");
      await tapFirstMark(page);
      await expect(page.getByTestId("xray-card")).toContainText("Where it appears");
      const xcard = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(xcard.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join(" | ")}`)).toEqual([]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-xray-card-${name}-${scheme}.png` });
      await page.getByTestId("xray-card").getByRole("button", { name: "Close" }).click();

      await page.getByRole("button", { name: "Reading settings" }).click();
      await expect(page.getByRole("group", { name: "AI explanations" })).toBeVisible();
      const set = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(set.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/reader-settings-${name}-${scheme}.png` });

      await page.getByRole("button", { name: "Study" }).click();
      await page.getByRole("tab", { name: "Test yourself" }).click();
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

// M21: Ask this book, the third Study tab. A question is answered only from the book's own paragraphs (the fake AI
// quotes passage 1 and cites it as [1]); the price shows before anything is spent; [1] opens its paragraph.
test("Ask this book: a question answered from the book's paragraphs, with a [1] that opens the passage", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAtPhrase(page, "London was startled by a crime of singular ferocity");
  const askPanel = page.getByRole("region", { name: "Ask this book" });
  const answer = page.getByTestId("ask-answer");
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Ask" }).click();
  await expect(page.getByRole("tab", { name: "Ask" })).toHaveAttribute("aria-selected", "true");

  // The price shows before anything is spent; the button waits for a question.
  const button = askPanel.getByRole("button", { name: /^Ask \((about \$0\.\d\d|under \$0\.01)\)$/ });
  await expect(button).toBeDisabled();

  // No word of the question is in this book: nothing is asked, nothing is spent.
  await askPanel.getByLabel("Your question").fill("What about the Eloi and the Morlocks?");
  await button.click();
  await expect(askPanel.getByRole("status")).toContainText("No paragraph of this book has the words");
  await expect(answer).toHaveCount(0);

  await askPanel.getByLabel("Your question").fill("What was his rugged countenance like?");
  await button.click();
  await expect(answer).toContainText("Answer from the book · written by the test AI");
  await expect(answer).toContainText("“Mr. Utterson the lawyer was a man of a rugged countenance that…”");
  await expect(answer).toContainText(/fake · \d+ \w+ \d{4} · \$0\.\d+/);
  await expect(askPanel).toContainText("“What was his rugged countenance like?”");
  const cited = page.getByTestId("ask-passages").getByRole("button");
  await expect(cited).toHaveCount(1);
  await expect(cited).toContainText("[1] Story of the Door");
  await expect(cited).toContainText("Mr. Utterson the lawyer was a man of a rugged countenance");

  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await expect(answer).toBeVisible();
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join(" | ")}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/ask-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });

  // [1] opens its paragraph, in the first chapter; on a computer the panel stays beside the book for [2], [3]…
  const landed = () =>
    page.evaluate(() => {
      const view = document.querySelector("foliate-view") as unknown as { lastLocation: { range: Range } | null } | null;
      return view?.lastLocation?.range.toString() ?? "";
    });
  await answer.getByRole("button", { name: "[1] go to passage 1" }).click();
  await expect(page.locator("footer")).toContainText("Story of the Door");
  await expect.poll(landed).toContain("rugged countenance");
  await expect(answer).toBeVisible();

  // The answer is kept: closed and opened again it is still there, free. On a phone, where the panel covers the
  // page, a passage closes it.
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "The Carew Murder Case" }).click();
  await expect(page.locator("footer")).toContainText("The Carew Murder Case");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tab", { name: "Ask" }).click();
  await expect(answer).toContainText("rugged countenance");
  await cited.click();
  await expect(askPanel).toHaveCount(0);
  await expect.poll(landed).toContain("rugged countenance");
  await page.setViewportSize({ width: 1280, height: 800 });
});

// M26 R1 "Done when": Explain it back. The reader writes a summary of a chapter first; only then does the test AI
// point to lines it missed, each quoted from the book and opening its place. The summary is the reader's own note,
// and both it and the answer are kept after a reload. No answer exists, or is offered, before a summary.
test("Explain it back: a summary first, then the lines it missed, each opening its place; kept after a reload", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAtPhrase(page, "London was startled by a crime of singular ferocity");
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "Story of the Door" }).click();
  await expect(page.locator("footer")).toContainText("Story of the Door");
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tablist", { name: "Study" }).getByRole("tab", { name: "Explain it back" }).click();
  const explain = page.getByRole("region", { name: "Explain it back" });
  const attempts = page.getByTestId("explain-attempt");
  await expect(explain).toContainText("Story of the Door");

  // Nothing from the AI before a summary: no answer, and the button waits for enough words.
  const button = explain.getByRole("button", { name: /^Check my summary \((about \$0\.\d\d|under \$0\.01)\)$/ });
  await expect(button).toBeDisabled();
  await expect(attempts).toHaveCount(0);
  await explain.getByLabel("In your own words: what did this part argue?").fill("A stern lawyer walks.");
  await expect(button).toBeDisabled();
  await expect(explain).toContainText("A few more words: at least 8.");

  const summary = "Utterson, a stern but tolerant lawyer, walks with Enfield, who tells of a man trampling a child and paying with a cheque signed by someone respectable.";
  await explain.getByLabel("In your own words: what did this part argue?").fill(summary);
  await button.click();
  const attempt = attempts.first();
  await expect(attempt).toContainText(`“${summary}”`);
  await expect(attempt).toContainText("What your summary missed · written by the test AI");
  await expect(attempt).toContainText("Missed");
  await expect(attempt).toContainText("Not quite");
  await expect(attempt).toContainText("“Mr. Utterson the lawyer was a man of a rugged countenance that");
  await expect(attempt).toContainText(/fake · \d+ \w+ \d{4} · \$0\.\d+/);
  await expect(explain.getByLabel("In your own words: what did this part argue?")).toHaveValue(""); // ready for another try

  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await expect(attempt).toBeVisible();
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${name} ${scheme}: sideways scroll`).toBeLessThanOrEqual(0);
      // The panel itself never scrolls sideways (four tabs in one row once pushed its left edge out of sight).
      expect(await explain.evaluate((el) => el.scrollWidth - el.clientWidth), `${name} ${scheme}: the panel scrolls sideways`).toBeLessThanOrEqual(0);
      await attempt.getByRole("button", { name: /go to this place/ }).first().scrollIntoViewIfNeeded(); // the answer in view
      await page.screenshot({ path: `screenshots/explain-back-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });

  // Each quoted line opens its place in the book: the first paragraph, then the second.
  const landed = () =>
    page.evaluate(() => {
      const view = document.querySelector("foliate-view") as unknown as { lastLocation: { range: Range } | null } | null;
      return view?.lastLocation?.range.toString() ?? "";
    });
  const lines = attempt.getByRole("button", { name: /go to this place/ });
  await expect(lines).toHaveCount(2);
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "Search for Mr. Hyde" }).click();
  await expect(page.locator("footer")).toContainText("Search for Mr. Hyde");
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tab", { name: "Explain it back" }).click();
  await expect(attempts).toHaveCount(0); // another chapter: its own summaries, none yet
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "Story of the Door" }).click();
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tab", { name: "Explain it back" }).click();
  await lines.nth(1).click();
  await expect.poll(landed).not.toBe("");
  await expect(page.locator("footer")).toContainText("Story of the Door");
  await lines.first().click();
  await expect.poll(landed).toContain("rugged countenance");

  // The summary is the reader's own note on the chapter.
  await page.getByRole("button", { name: "Notes" }).click();
  await expect(page.getByTestId("notes")).toContainText(summary);

  // Kept after a reload; the same summary again is answered from storage, free, and adds no second note.
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  // The reader reopens at the place it saved last, which may be another chapter: go back to this one.
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Contents" }).getByRole("button", { name: "Story of the Door" }).click();
  await expect(page.locator("footer")).toContainText("Story of the Door");
  await page.getByRole("button", { name: "Study" }).click();
  await page.getByRole("tab", { name: "Explain it back" }).click();
  await expect(attempts.first()).toContainText(`“${summary}”`);
  await expect(attempts.first()).toContainText("“Mr. Utterson the lawyer was a man of a rugged countenance that");
  await explain.getByLabel("In your own words: what did this part argue?").fill(summary);
  await button.click();
  await expect(attempts.first()).toContainText("checked before, so this time free");
  await expect(attempts).toHaveCount(1);
  const { annotations } = (await (await page.request.get(`/api/books/${bookIdOf(page)}/annotations`)).json()) as { annotations: { body: string }[] };
  expect(annotations.filter((a) => a.body === summary)).toHaveLength(1);
});
