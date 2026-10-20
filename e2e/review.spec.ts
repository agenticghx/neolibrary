import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { dayAfter, formatDay } from "../lib/library/review-schedule";
import { ADMIN_STATE } from "./pages";

// M21 "Done when": a reader's highlights with notes come back on /review one at a time: the passage first,
// the note on Show (or Space), rated with the keys 1 to 4; Again brings a card back at the end; then the empty
// state names the next day; Go to passage opens the reader there. A reader of its own (invited here), so the
// projects that run beside this one (home, after stats) see none of its notes.

const axe = async (page: Page, look: string) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${look} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
};

/** A page in the four looks: accessible, no sideways scroll on a phone, a screenshot for the PR's grid (as own-paths.spec.ts). */
async function fourLooks(page: Page, name: string, ready: () => Promise<void>) {
  await mkdir("screenshots", { recursive: true });
  for (const [size, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await ready();
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.fonts.ready);
      await axe(page, `${size} ${scheme}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/${name}-${size}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
}

/** The owner invites a new reader, who joins; returns the reader's page (signed in, on Home). */
async function newReader(page: Page, browser: Browser) {
  await page.goto("/admin/invites");
  await page.getByLabel(/Who is it for/).fill("Rhea, daily review");
  await page.getByRole("button", { name: "Make an invitation link" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 800 } });
  const reader = await ctx.newPage();
  await reader.goto(link);
  await reader.getByLabel("Your name").fill("Rhea Reviewer");
  await reader.getByLabel("Email address").fill(`review-${Date.now()}@example.com`);
  await reader.getByLabel("Password").fill("spaced repetition works");
  await reader.getByRole("button", { name: "Join the library" }).click();
  await expect(reader.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  return reader;
}

/** A highlight with a note on the paragraph that starts with `start` (found with Find in this book). */
async function highlight(page: Page, bookId: string, words: string, start: string, note: string) {
  const { hits } = await (await page.request.get(`/api/books/${bookId}/search?q=${encodeURIComponent(words)}`)).json();
  const hit = hits[0] as { cfi: string };
  const cfi = hit.cfi.replace(/\)$/, `,/1:0,/1:${start.length})`);
  const res = await page.request.post(`/api/books/${bookId}/annotations`, { data: { kind: "highlight", cfi, quote: { exact: start }, color: "sage", body: note } });
  expect(res.status()).toBe(201);
  return { cfi, id: (await res.json()).id as string };
}

test.use({ storageState: ADMIN_STATE });

test("Daily review: the passage, Show, rate with the keys, Again comes back, then the next day; Go to passage opens the reader", async ({ page, browser }) => {
  test.setTimeout(120_000); // four looks, the reader, and a dozen steps
  const reader = await newReader(page, browser);
  const upload = await reader.request.post("/api/books", {
    multipart: {
      files: { name: "shelley-frankenstein.epub", mimeType: "application/epub+zip", buffer: readFileSync("fixtures/books/shelley-frankenstein.epub") },
    },
  });
  const bookId = (await upload.json()).results[0].bookId as string;

  // Nothing marked yet: an empty state that says how cards are made, and no count in the sidebar.
  await reader.goto("/review");
  await expect(reader.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
  await expect(reader.getByTestId("review-empty")).toContainText("Nothing to review yet.");
  const reviewLink = reader.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Review/ });
  await expect(reviewLink).toHaveText("Review");
  await expect(reviewLink).toHaveAttribute("aria-current", "page");

  // Two highlights with notes, made in this order (new cards come oldest first).
  const first = "You will rejoice to hear that no disaster has accompanied the commencement of an enterprise";
  const second = "How slowly the time passes here, encompassed as I am by frost and snow";
  const a = await highlight(reader, bookId, "rejoice disaster commencement enterprise", first, "Walton writes home to his sister, full of hope.");
  await highlight(reader, bookId, "slowly encompassed frost snow", second, "He has no friend on the voyage.");

  // The sidebar counts them; on a phone, Home says so under its title.
  await reader.goto("/review");
  await expect(reviewLink).toHaveText("Review2 due today");
  await reader.setViewportSize({ width: 390, height: 844 });
  await reader.goto("/");
  await expect(reader.getByRole("link", { name: "Review: 2 cards due today" })).toBeVisible();
  await reader.setViewportSize({ width: 1280, height: 800 });

  // The four looks, with the first card's note shown and the four ratings.
  await reader.goto("/review");
  const card = reader.getByTestId("review-card");
  const answer = reader.getByTestId("review-answer");
  const progress = reader.getByTestId("review-progress");
  await fourLooks(reader, "review", async () => {
    await expect(card.getByRole("blockquote")).toHaveText(first);
    await reader.getByRole("button", { name: "Show", exact: true }).click();
    await expect(answer).toBeVisible();
  });

  // Go to passage opens the reader at the highlight.
  await reader.reload();
  await expect(card.getByText(/^Frankenstein · Letter I$/)).toBeVisible(); // the book and the chapter the passage is in
  await card.getByRole("link", { name: "Go to passage" }).click();
  await expect(reader).toHaveURL(new RegExp(`/books/${bookId}/read\\?at=${encodeURIComponent(a.cfi).replace(/[()]/g, "\\$&")}$`));
  await expect(reader.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(reader.locator("footer").getByText(/^Letter I$/)).toBeVisible(); // at that chapter, not the book's start

  // Card 1 of 2: the passage, its book; the note hidden until Space.
  await reader.goto("/review");
  await expect(progress).toContainText("1 of 2");
  await expect(card.getByRole("blockquote")).toHaveText(first);
  await expect(answer).toHaveCount(0);
  await expect(reader.getByText("Walton writes home to his sister, full of hope.")).toHaveCount(0);
  await expect(reader.getByRole("button", { name: /^Good/ })).toHaveCount(0); // no rating before the note shows
  await reader.keyboard.press("3"); // ignored: nothing shown yet
  await expect(progress).toContainText("1 of 2");
  await reader.keyboard.press(" ");
  await expect(answer).toContainText("Walton writes home to his sister, full of hope.");
  await expect(reader.getByRole("group", { name: "How well did you remember it?" }).getByRole("button")).toHaveText([
    "Againtoday",
    "Hardtomorrow",
    "Goodtomorrow",
    "Easyin 4 days",
  ]);

  // 1 = Again: the card goes to the end of today's cards.
  await reader.keyboard.press("1");
  await expect(progress).toContainText("2 of 3");
  await expect(card.getByRole("blockquote")).toHaveText(second);
  await expect(answer).toHaveCount(0);
  // A second Space after Show does not rate the card (focus is on the card, not a button).
  await reader.keyboard.press(" ");
  await expect(answer).toContainText("He has no friend on the voyage.");
  await reader.keyboard.press(" ");
  await expect(progress).toContainText("2 of 3");
  await reader.keyboard.press("3"); // Good

  // The first card again, learned from the start.
  await expect(progress).toContainText("3 of 3");
  await expect(card.getByRole("blockquote")).toHaveText(first);
  await reader.keyboard.press(" ");
  await reader.getByRole("button", { name: /^Good/ }).click();

  // Done for today: the next card is due tomorrow (days are counted in UTC), and the sidebar's count is gone.
  const empty = reader.getByTestId("review-empty");
  await expect(empty).toContainText("Nothing to review today.");
  await expect(empty).toContainText(`Next card: ${formatDay(dayAfter(new Date(), 1).toISOString())}.`);
  await expect(reviewLink).toHaveText("Review");
  // The last rating calls router.refresh() so the sidebar count updates. During that
  // refresh the page title can be empty for a moment (CI run 38273542441: axe reported
  // document-title on html). The check still requires a title; it waits until the refresh
  // has put "Review" back.
  await expect.poll(() => reader.title()).toMatch(/Review/);
  await axe(reader, "empty");
  // And so after a reload: both cards were saved.
  await reader.reload();
  await expect(empty).toContainText("Nothing to review today.");
  await reader.context().close();
});

// M28 S1 "Done when" (the browser half; the day's wait is checked in lib/library/review.test.ts with a test clock,
// as the server's clock cannot be moved from here, so this server sets REVIEW_QUESTION_DELAY_DAYS=0): a chapter's
// Test yourself questions are cards, the question on the front and the bank's answer only after Show; Go to chapter
// opens the reader in that chapter; a rating is saved.
test("Daily review: Test yourself questions are cards, the question first and its answer on Show", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const reader = await newReader(page, browser);
  const upload = await reader.request.post("/api/books", {
    multipart: {
      files: { name: "shelley-frankenstein.epub", mimeType: "application/epub+zip", buffer: readFileSync("fixtures/books/shelley-frankenstein.epub") },
    },
  });
  const bookId = (await upload.json()).results[0].bookId as string;
  const { hits } = await (await reader.request.get(`/api/books/${bookId}/search?q=${encodeURIComponent("rejoice disaster commencement enterprise")}`)).json();
  const at = (await (await reader.request.get(`/api/books/${bookId}/questions?cfi=${encodeURIComponent(hits[0].cfi)}`)).json()) as { chapter: { id: string; label: string } };
  const made = await reader.request.post(`/api/books/${bookId}/questions`, { data: { chapterId: at.chapter.id } });
  expect(made.ok()).toBe(true);
  const questions = ((await made.json()).generation.questions as { question: string; answer: string }[]).slice(0, 2);

  await reader.goto("/review");
  const card = reader.getByTestId("review-card");
  const answer = reader.getByTestId("review-answer");
  const progress = reader.getByTestId("review-progress");
  await expect(progress).toContainText("1 of 9");
  await expect(card.getByText(`Frankenstein · ${at.chapter.label}`)).toBeVisible();
  await expect(card.getByTestId("review-question")).toHaveText(questions[0].question);
  await expect(card.getByRole("blockquote")).toHaveCount(0);
  await expect(answer).toHaveCount(0);
  await expect(reader.getByText(questions[0].answer, { exact: true })).toHaveCount(0); // the answer only after Show
  await expect(reader.getByText("Keys: Space shows the answer; 1 Again, 2 Hard, 3 Good, 4 Easy.")).toBeVisible();

  await fourLooks(reader, "review-question", async () => {
    await expect(card.getByTestId("review-question")).toHaveText(questions[0].question);
    await reader.getByRole("button", { name: "Show", exact: true }).click();
    await expect(answer).toContainText(questions[0].answer);
  });

  // Go to chapter opens the reader in the question's chapter.
  await reader.reload();
  await card.getByRole("link", { name: "Go to chapter" }).click();
  await expect(reader).toHaveURL(new RegExp(`/books/${bookId}/read\\?at=`));
  await expect(reader.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(reader.locator("footer").getByText(at.chapter.label, { exact: true })).toBeVisible();

  // Space shows the answer, 3 rates it Good: the next question, and the rating survives a reload.
  await reader.goto("/review");
  await reader.keyboard.press(" ");
  await expect(answer).toContainText("Test yourself’s answer");
  await expect(answer).toContainText(questions[0].answer);
  await reader.keyboard.press("3");
  await expect(progress).toContainText("2 of 9");
  await expect(card.getByTestId("review-question")).toHaveText(questions[1].question);
  await reader.reload();
  await expect(progress).toContainText("1 of 8");
  await expect(card.getByTestId("review-question")).toHaveText(questions[1].question);
  await reader.context().close();
});

