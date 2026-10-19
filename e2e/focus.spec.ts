import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M26 R3 "Done when": a browser test starts a session with a question and a short timer, sees only the page while
// it runs, answers at the end, and then finds the answer as a note, as a card in Daily review, and as a sitting
// with the question on the Reading stats page; the session survives a reload part-way through. A reader of its
// own (invited here), so the Daily review queue holds this one card and the other projects see no new note.
// The browser's clock is controlled (page.clock), so the timer's minutes pass in milliseconds.

test.use({ storageState: ADMIN_STATE });

const axe = async (page: Page, look: string) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${look} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
};

/** The reader in the four looks: accessible, no sideways scroll on a phone, a screenshot for the PR's grid (as review.spec.ts). */
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
      await page.screenshot({ path: `screenshots/${name}-${size}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
}

/** The owner invites a new reader, who joins; returns the reader's page (signed in, on Home). */
async function newReader(page: Page, browser: Browser) {
  await page.goto("/admin/invites");
  await page.getByLabel(/Who is it for/).fill("Fola, focus sessions");
  await page.getByRole("button", { name: "Make an invitation link" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 800 } });
  const reader = await ctx.newPage();
  await reader.goto(link);
  await reader.getByLabel("Your name").fill("Fola Focus");
  await reader.getByLabel("Email address").fill(`focus-${Date.now()}@example.com`);
  await reader.getByLabel("Password").fill("one question at a time");
  await reader.getByRole("button", { name: "Join the library" }).click();
  await expect(reader.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  return reader;
}

const QUESTION = "Why does the Time Traveller go forward, and not back?";
const ANSWER = "Because the future is the one place no one has written about yet.";

test("a focus session: a question and a timer, only the page, a reload part-way, then the answer as a note, a review card and a sitting", async ({ page, browser }) => {
  test.setTimeout(180_000); // two sessions, eight looks, the reader opened a dozen times
  const reader = await newReader(page, browser);
  const upload = await reader.request.post("/api/books", {
    multipart: {
      files: { name: "wells-the-time-machine.epub", mimeType: "application/epub+zip", buffer: readFileSync("fixtures/books/wells-the-time-machine.epub") },
    },
  });
  const bookId = (await upload.json()).results[0].bookId as string;

  await reader.clock.install({ time: new Date("2026-10-18T09:00:00Z") });
  await reader.goto(`/books/${bookId}/read`);
  const view = reader.getByTestId("reader");
  const ready = async () => expect(view).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await ready();
  await expect(view.locator("header")).toBeVisible();
  await expect(view.locator("footer")).toBeVisible();

  // The question and the timer. A blank question does not start anything.
  await view.getByRole("button", { name: "Focus session" }).click();
  const start = reader.getByTestId("focus-start");
  await expect(start).toBeVisible();
  await start.getByRole("button", { name: "Start" }).click();
  await expect(start.getByRole("alert")).toContainText("Write the question");
  await start.getByLabel("What are you reading to answer?").fill(QUESTION);
  await start.getByLabel("Minutes").fill("2");
  await start.getByRole("button", { name: "Start" }).click();

  // Only the page: the top bar and the foot are gone; a strip shows the question, the time left, End now.
  await expect(start).toBeHidden();
  await expect(view.locator("header")).toHaveCount(0);
  await expect(view.locator("footer")).toBeHidden();
  await expect(view.getByRole("button", { name: "Notes" })).toHaveCount(0);
  const strip = view.getByTestId("focus-strip");
  await expect(strip).toContainText(QUESTION);
  await expect(reader.getByTestId("focus-clock")).toHaveText("2:00");
  await reader.clock.runFor(60_000);
  await expect(reader.getByTestId("focus-clock")).toHaveText(/^(1:00|0:5\d)$/);

  // A reload part-way through: the session is still running, with the time that was left.
  await reader.reload();
  await ready();
  await expect(view.locator("header")).toHaveCount(0);
  await expect(view.getByTestId("focus-strip")).toContainText(QUESTION);
  await expect(reader.getByTestId("focus-clock")).toHaveText(/^(1:00|0:5\d)$/);
  await expect(reader.getByTestId("focus-end")).toBeHidden();

  // Time's up: "Did you answer it?", with the question. The answer is saved.
  await reader.clock.runFor(60_000);
  const end = reader.getByTestId("focus-end");
  await expect(end).toBeVisible();
  await expect(end).toContainText("Time's up. Did you answer it?");
  await expect(end).toContainText(QUESTION);
  await end.getByRole("button", { name: "Save the answer" }).click();
  await expect(end.getByRole("alert")).toContainText("Write your answer");
  await end.getByLabel("Your answer").fill(ANSWER);
  await end.getByRole("button", { name: "Save the answer" }).click();
  await expect(end).toBeHidden();
  await expect(view.locator("header")).toBeVisible();
  await expect(view.locator("footer")).toBeVisible();

  // As a note on the book, repeating the question.
  type Note = { id: string; kind: string; body: string; cfi: string | null };
  const notes = (await (await reader.request.get(`/api/books/${bookId}/annotations`)).json()).annotations as Note[];
  const note = notes.find((n) => n.kind === "note" && n.body.includes(ANSWER));
  expect(note).toBeDefined();
  expect(note!.body).toBe(`Question: ${QUESTION}\n\nAnswer: ${ANSWER}`);
  await view.getByRole("button", { name: /^Notes/ }).click();
  await expect(view.getByRole("navigation", { name: "Notes" }).getByTestId("notes")).toContainText(ANSWER);

  // As a sitting with its question (the tracker reports the session; the answer links every sitting of it).
  type Sitting = { bookId: string; focusId: string | null; question: string; answerAnnotationId: string | null; activeSeconds: number };
  const sittings = async () => ((await (await reader.request.get("/api/export")).json()).readingSessions as Sitting[]).filter((s) => s.bookId === bookId && s.focusId);
  await expect.poll(async () => (await sittings()).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2); // before and after the reload
  const ours = await sittings();
  expect(new Set(ours.map((s) => s.focusId)).size).toBe(1);
  expect(ours.every((s) => s.question === QUESTION)).toBe(true);
  await expect.poll(async () => (await sittings()).every((s) => s.answerAnnotationId === note!.id), { timeout: 10_000 }).toBe(true);

  // As a card in Daily review: a note on the whole book, the answer behind Show.
  await reader.goto("/review");
  const card = reader.getByTestId("review-card");
  await expect(card).toContainText("The Time Machine");
  await expect(card).toContainText("Your note on the whole book");
  await reader.getByRole("button", { name: "Show", exact: true }).click();
  await expect(reader.getByTestId("review-answer")).toContainText(ANSWER);

  // On the Reading stats page, the session with its question, its time and its answer.
  await reader.goto("/stats");
  const list = reader.getByTestId("stats-focus");
  await expect(list).toContainText(QUESTION);
  await expect(list).toContainText(ANSWER);
  // The question once, as the heading of the session; the answer under it without the note's own "Question:" line.
  await expect(list).not.toContainText("Question:");
  await expect(list).toContainText("The Time Machine");
  await expect(list).toContainText("18 Oct 2026");

  // The four looks of a running session, and of the question at the end; then it ends with no answer (nothing saved).
  await reader.goto(`/books/${bookId}/read`);
  await ready();
  await view.getByRole("button", { name: "Focus session" }).click();
  await mkdir("screenshots", { recursive: true });
  await reader.screenshot({ path: "screenshots/focus-start-desktop-light.png" });
  await reader.getByTestId("focus-start").getByLabel("What are you reading to answer?").fill("What does the Time Traveller make of the Eloi?");
  await reader.getByTestId("focus-start").getByRole("button", { name: "Start" }).click();
  await expect(reader.getByTestId("focus-clock")).toHaveText("50:00");
  await fourLooks(reader, "focus-session", async () => {
    await ready();
    await expect(reader.getByTestId("focus-strip")).toBeVisible();
  });
  await reader.clock.runFor(50 * 60_000);
  await fourLooks(reader, "focus-answer", async () => {
    await ready();
    await expect(reader.getByTestId("focus-end")).toBeVisible();
  });
  await reader.getByTestId("focus-end").getByRole("button", { name: "No answer yet" }).click();
  await expect(reader.getByTestId("focus-end")).toBeHidden();
  await expect(view.locator("header")).toBeVisible();
  const after = (await (await reader.request.get(`/api/books/${bookId}/annotations`)).json()).annotations as Note[];
  expect(after.filter((n) => n.kind === "note")).toHaveLength(notes.filter((n) => n.kind === "note").length);
  await reader.goto("/stats");
  await expect(reader.getByTestId("stats-focus").getByRole("listitem")).toHaveCount(2);
  await expect(reader.getByTestId("stats-focus")).toContainText("No answer saved.");
});
