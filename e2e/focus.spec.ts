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
async function newReader(page: Page, browser: Browser, email = `focus-${Date.now()}@example.com`) {
  await page.goto("/admin/invites");
  await page.getByLabel(/Who is it for/).fill("Fola, focus sessions");
  await page.getByRole("button", { name: "Make an invitation link" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 800 } });
  const reader = await ctx.newPage();
  await reader.goto(link);
  await reader.getByLabel("Your name").fill("Fola Focus");
  await reader.getByLabel("Email address").fill(email);
  await reader.getByLabel("Password").fill(PASSWORD);
  await reader.getByRole("button", { name: "Join the library" }).click();
  await expect(reader.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  return reader;
}

const PASSWORD = "one question at a time";
const QUESTION = "Why does the Time Traveller go forward, and not back?";
// 40 words or more: the browser's clock says the time is up, but the server's says it is not (M26 R4b's rule).
const ANSWER =
  "Because the future is the one place no one has written about yet. The past is known from books and from memory, so it holds no surprise. He wants to test his idea of time against something he cannot predict, and to see where mankind goes.";

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

  // Only the page: the top bar and the foot are gone; a strip shows the question, the time left, Leave early….
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
  // M26 R4b: it ends early only by the wait (shortened to 30 seconds for the tests); then the question at the end.
  await view.getByTestId("focus-strip").getByRole("button", { name: "Leave early…" }).click();
  await reader.getByTestId("focus-leave").getByRole("button", { name: /^Start the .* wait$/ }).click();
  await expect(reader.getByTestId("focus-wait")).toContainText("Leaving in");
  await expect(reader.getByTestId("focus-end")).toContainText("The wait is over. Did you answer it?", { timeout: 40_000 });
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
  // How each ended (M26 R4b): the first answered before the server's time was up, the second after the wait.
  await expect(reader.getByTestId("stats-focus-ended")).toHaveText([" · Left after a wait", " · Answered early"]);
});

// M26 R4b "Done when": the ways out of a session before its time is up. (1) A 30-word answer cannot leave and a
// 40-word answer can, and the note is saved; nor can one request to the server end it. (2) The wait (30 seconds
// here, FOCUS_WAIT_MS; 10 minutes on the live site) survives a reload, Keep reading cancels it, and at zero the
// answer dialog opens. (3) Reading stats shows "Answered early" and "Left after a wait". The waits are real time
// (the server's clock), so there is no page.clock here.
test("leaving a focus session early: an answer of 40 words, or the wait", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const reader = await newReader(page, browser, `focus-leave-${Date.now()}@example.com`);
  const res = await reader.request.post("/api/books", {
    multipart: { files: { name: "wells-the-time-machine.epub", mimeType: "application/epub+zip", buffer: readFileSync("fixtures/books/wells-the-time-machine.epub") } },
  });
  const bookId = (await res.json()).results[0].bookId as string;
  await reader.goto(`/books/${bookId}/read`);
  const view = reader.getByTestId("reader");
  const ready = () => expect(view).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await ready();
  const begin = async (question: string) => {
    await view.getByRole("button", { name: "Focus session" }).click();
    const start = reader.getByTestId("focus-start");
    await start.getByLabel("What are you reading to answer?").fill(question);
    await start.getByLabel("Minutes").fill("30");
    await start.getByRole("button", { name: "Start" }).click();
    await expect(reader.getByTestId("focus-strip")).toContainText(question);
    return (await (await reader.request.get("/api/focus")).json()).session as { id: string; running: boolean; waitRemainingMs: number | null };
  };
  const words = (n: number) => ANSWER.split(" ").slice(0, n).join(" ");

  // The start dialog explains how to lock the phone itself; it changes nothing.
  await view.getByRole("button", { name: "Focus session" }).click();
  const start = reader.getByTestId("focus-start");
  await start.getByText("Lock this phone to the page too").click();
  await expect(start).toContainText("Guided Access");
  await expect(start).toContainText("App pinning");
  await start.getByRole("button", { name: "Cancel" }).click();

  // (1) Leave early… with an answer.
  const first = await begin(QUESTION);
  // One request to the server cannot end it: not without an answer, nor with a short one.
  expect((await reader.request.post("/api/focus/end", { data: { id: first.id } })).status()).toBe(409);
  const short = await reader.request.post(`/api/books/${bookId}/focus`, { data: { focusId: first.id, question: QUESTION, answer: words(30) } });
  expect(short.status()).toBe(400);
  expect((await short.json()).error).toContain("at least 40 words (this has 30)");
  expect((await (await reader.request.get("/api/focus")).json()).session).toMatchObject({ id: first.id, running: true });

  await view.getByTestId("focus-strip").getByRole("button", { name: "Leave early…" }).click();
  const leave = reader.getByTestId("focus-leave");
  await expect(leave).toContainText(QUESTION);
  // Escape (or Keep reading) changes nothing.
  await reader.keyboard.press("Escape");
  await expect(leave).toBeHidden();
  await expect(reader.getByTestId("focus-clock")).toBeVisible();
  await view.getByTestId("focus-strip").getByRole("button", { name: "Leave early…" }).click();
  // The four looks of the dialog (no reload: a dialog does not survive one).
  await mkdir("screenshots", { recursive: true });
  for (const [size, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await reader.setViewportSize({ width, height });
      await reader.emulateMedia({ colorScheme: scheme });
      await expect(leave).toBeVisible();
      await axe(reader, `leave ${size} ${scheme}`);
      expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await reader.screenshot({ path: `screenshots/focus-leave-${size}-${scheme}.png` });
    }
  }
  await reader.setViewportSize({ width: 1280, height: 800 });
  await reader.emulateMedia({ colorScheme: "light" });
  const save = leave.getByRole("button", { name: "Save the answer and leave" });
  await leave.getByLabel("Your answer").fill(words(30));
  await expect(leave.getByTestId("focus-leave-count")).toHaveText("30 of 40 words");
  await expect(save).toBeDisabled();
  await leave.getByLabel("Your answer").fill(words(40));
  await expect(leave.getByTestId("focus-leave-count")).toHaveText("40 of 40 words");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(leave).toBeHidden();
  await expect(view.locator("header")).toBeVisible();
  expect((await (await reader.request.get("/api/focus")).json()).session).toBeNull();
  type Note = { kind: string; body: string };
  const notes = (await (await reader.request.get(`/api/books/${bookId}/annotations`)).json()).annotations as Note[];
  expect(notes.filter((n) => n.kind === "note").map((n) => n.body)).toEqual([`Question: ${QUESTION}\n\nAnswer: ${words(40)}`]);

  // (2) The wait.
  const second = await begin("What does the Time Traveller make of the Eloi?");
  const waitSeconds = async () => {
    const [m, sec] = (await reader.getByTestId("focus-wait").innerText()).replace("Leaving in ", "").split(":").map(Number);
    return m * 60 + sec;
  };
  const startWait = async () => {
    await view.getByTestId("focus-strip").getByRole("button", { name: "Leave early…" }).click();
    await reader.getByTestId("focus-leave").getByRole("button", { name: /^Start the .* wait$/ }).click();
    await expect(reader.getByTestId("focus-leave")).toBeHidden();
    await expect(reader.getByTestId("focus-wait")).toHaveText(/^Leaving in 0:[0-3]\d$/);
  };
  await startWait();
  const before = await waitSeconds();
  // A reload does not skip it, nor start it again: the server keeps its end.
  await reader.reload();
  await ready();
  await expect(reader.getByTestId("focus-wait")).toHaveText(/^Leaving in /);
  expect(await waitSeconds()).toBeLessThanOrEqual(before);
  const waiting = (await (await reader.request.get("/api/focus")).json()).session;
  expect(waiting).toMatchObject({ id: second.id, running: true });
  expect(waiting.waitRemainingMs).toBeGreaterThan(0);
  // While it runs, the server still will not end the session without an answer.
  expect((await reader.request.post("/api/focus/end", { data: { id: second.id } })).status()).toBe(409);
  // Keep reading cancels it, on the server too.
  await view.getByTestId("focus-strip").getByRole("button", { name: "Keep reading" }).click();
  await expect(reader.getByTestId("focus-clock")).toBeVisible();
  await expect(reader.getByTestId("focus-wait")).toHaveCount(0);
  expect((await (await reader.request.get("/api/focus")).json()).session.waitRemainingMs).toBeNull();
  // Again, and this time to the end; the look of the strip while it runs (no reload).
  await startWait();
  for (const [size, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await reader.setViewportSize({ width, height });
      await reader.emulateMedia({ colorScheme: scheme });
      await expect(reader.getByTestId("focus-wait")).toBeVisible();
      await reader.mouse.move(0, 0);
      await reader.screenshot({ path: `screenshots/focus-waiting-${size}-${scheme}.png` });
    }
  }
  await reader.setViewportSize({ width: 1280, height: 800 });
  await reader.emulateMedia({ colorScheme: "light" });
  await axe(reader, "waiting");
  const end = reader.getByTestId("focus-end");
  await expect(end).toContainText("The wait is over. Did you answer it?", { timeout: 40_000 });
  await end.getByRole("button", { name: "No answer yet" }).click();
  await expect(end).toBeHidden();
  await expect(view.locator("header")).toBeVisible();
  expect((await (await reader.request.get("/api/focus")).json()).session).toBeNull();

  // (3) Reading stats says how each ended.
  await reader.goto("/stats");
  await expect(reader.getByTestId("stats-focus-ended")).toHaveText([" · Left after a wait", " · Answered early"]);
});

// M26 R4a "Done when": the running session lives on the server. A 2-minute session; Library, Search and another
// book land back on the focused book, and so does a link followed inside the app; a second browser signed in as
// the same reader lands there too, and signing out there does not end the session; a reload keeps the time left;
// another book's file is refused (423 Locked); once the time is up every page opens normally. The server's clock
// cannot be wound forward from a test, so this one waits the real two minutes (no page.clock here).
test("a focus session you cannot walk away from: every page and every browser goes to the focused book until the time is up", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const email = `focus-lock-${Date.now()}@example.com`;
  const reader = await newReader(page, browser, email);
  const upload = async (file: string) => {
    const res = await reader.request.post("/api/books", {
      multipart: { files: { name: file, mimeType: "application/epub+zip", buffer: readFileSync(`fixtures/books/${file}`) } },
    });
    return (await res.json()).results[0].bookId as string;
  };
  const tm = await upload("wells-the-time-machine.epub");
  const jekyll = await upload("stevenson-jekyll-and-hyde.epub");
  const focused = new RegExp(`/books/${tm}/read$`);

  await reader.goto(`/books/${tm}/read`);
  const view = reader.getByTestId("reader");
  await expect(view).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await view.getByRole("button", { name: "Focus session" }).click();
  const start = reader.getByTestId("focus-start");
  await start.getByLabel("What are you reading to answer?").fill(QUESTION);
  await start.getByLabel("Minutes").fill("2");
  await start.getByRole("button", { name: "Start" }).click();
  await expect(reader.getByTestId("focus-strip")).toContainText(QUESTION);
  const startedAt = Date.now();
  const session = (await (await reader.request.get("/api/focus")).json()).session;
  // The checks below must finish inside the session's two minutes; say so plainly if a slow machine runs out.
  const stillRunning = async (step: string) => {
    const running = (await (await reader.request.get("/api/focus")).json()).session?.running;
    expect(running, `the session ended before ${step} (${Math.round((Date.now() - startedAt) / 1000)} s after it started)`).toBe(true);
  };
  expect(session).toMatchObject({ bookId: tm, question: QUESTION, minutes: 2, running: true });

  // A second session cannot start while this one runs (the database keeps one per reader).
  const second = await reader.request.post("/api/focus", { data: { bookId: jekyll, question: "Another?", minutes: 5 } });
  expect(second.status()).toBe(409);

  // Library, Search and another book: each lands back on the focused book, with the strip.
  for (const path of ["/library", "/search?q=time", `/books/${jekyll}/read`, "/", "/stats"]) {
    await reader.goto(path);
    await expect(reader, path).toHaveURL(focused);
    await expect(reader.getByTestId("focus-strip")).toContainText(QUESTION);
  }
  // Account opens (Sign out is there); a link followed inside the app goes back to the book.
  await reader.goto("/account");
  await expect(reader).toHaveURL(/\/account$/);
  await expect(reader.getByTestId("account-focus")).toContainText("The Time Machine");
  await reader.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Review", exact: true }).click();
  await expect(reader).toHaveURL(focused);
  await expect(reader.getByTestId("focus-strip")).toBeVisible();

  // Another book's file is refused (423 Locked); the focused book's is not.
  expect((await reader.request.get(`/api/books/${jekyll}/file-link`)).status()).toBe(423);
  expect((await reader.request.get(`/api/books/${tm}/file-link`)).status()).toBe(200);

  // A reload keeps the time left.
  const seconds = async () => {
    const [m, sec] = (await reader.getByTestId("focus-clock").innerText()).split(":").map(Number);
    return m * 60 + sec;
  };
  await expect(reader.getByTestId("focus-clock")).toHaveText(/^[01]:\d\d$/);
  const before = await seconds();
  await reader.reload();
  await expect(reader.getByTestId("focus-strip")).toContainText(QUESTION);
  const after = await seconds();
  expect(after).toBeLessThanOrEqual(before);
  expect(after).toBeGreaterThan(before - 15);

  // The look of Account while a session runs.
  await reader.goto("/account");
  await fourLooks(reader, "focus-account", async () => {
    await expect(reader.getByTestId("account-focus")).toBeVisible();
  });

  await stillRunning("the second browser");
  // A second browser, the same reader: signing in lands on the focused book. Signing out there (from Account,
  // where a phone finds it) and back in: the session is still running.
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  const phone = await ctx.newPage();
  const signIn = async () => {
    await phone.goto("/sign-in");
    await phone.getByLabel("Email address").fill(email);
    await phone.getByLabel("Password").fill(PASSWORD);
    await phone.getByRole("button", { name: "Sign in" }).click();
    await expect(phone).toHaveURL(focused);
    await expect(phone.getByTestId("focus-strip")).toContainText(QUESTION);
  };
  await signIn();
  await phone.goto("/library");
  await expect(phone).toHaveURL(focused);
  await phone.goto("/account");
  await phone.getByTestId("account-focus").getByRole("button", { name: "Sign out" }).click();
  await expect(phone).toHaveURL(/\/sign-in$/);
  await signIn();
  await stillRunning("the wait");

  // Once the time is up (by the server's clock), every page opens normally, in both browsers.
  await expect
    .poll(async () => (await (await reader.request.get("/api/focus")).json()).session?.running, { timeout: 150_000 - (Date.now() - startedAt), intervals: [2_000] })
    .toBe(false);
  for (const p of [reader, phone]) {
    await p.goto("/library");
    await expect(p).toHaveURL(/\/library$/);
    await p.goto("/search?q=time");
    await expect(p).toHaveURL(/\/search\?q=time$/);
    await p.goto(`/books/${jekyll}/read`);
    await expect(p).toHaveURL(new RegExp(`/books/${jekyll}/read$`));
    await expect(p.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  }
  expect((await reader.request.get(`/api/books/${jekyll}/file-link`)).status()).toBe(200);
  await ctx.close();
});

// M26 R5 "Done when": a whole-book focus on a public-domain book; Home and Library show only that book (they go to
// its page); another book's reader goes there too; jumping to the last page brings up the question; the answer is a
// note. Leaving early with a short answer is refused, and the wait (20 seconds here, FOCUS_BOOK_WAIT_MS) starts and
// can be cancelled. R5b: Daily review holds only this book's cards; Reading stats has a card for the focus.
const BOOK_QUESTION = "What does the Time Traveller learn about where mankind is going?";
const BOOK_ANSWER = "That comfort without struggle makes people weak, and that the split between those who work and those who rest can harden into two kinds of creature.";
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

test("whole-book focus: only this book, for days; leaving early takes 150 words or a wait; the last page asks the question", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const reader = await newReader(page, browser, `book-focus-${Date.now()}@example.com`);
  const upload = async (file: string) => {
    const res = await reader.request.post("/api/books", {
      multipart: { files: { name: file, mimeType: "application/epub+zip", buffer: readFileSync(`fixtures/books/${file}`) } },
    });
    return (await res.json()).results[0].bookId as string;
  };
  const tm = await upload("wells-the-time-machine.epub");
  const jekyll = await upload("stevenson-jekyll-and-hyde.epub");
  const view = reader.getByTestId("reader");
  const ready = async () => expect(view).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  // A note on each book: two cards in Daily review before the focus.
  for (const [id, body] of [
    [tm, "The Eloi and the Morlocks are one people, split."],
    [jekyll, "Utterson is the lawyer."],
  ]) {
    expect((await reader.request.post(`/api/books/${id}/annotations`, { data: { kind: "note", body } })).status()).toBe(201);
  }

  // Start it from the reader: the whole book, a question, three days.
  await reader.goto(`/books/${tm}/read`);
  await ready();
  await view.getByRole("button", { name: "Focus session" }).click();
  const start = reader.getByTestId("focus-start");
  await start.getByLabel("The whole book").check();
  await start.getByLabel("What are you reading this book to answer?").fill(BOOK_QUESTION);
  await start.getByLabel(/^Days/).fill("3");
  await start.getByRole("button", { name: "Start" }).click();
  const line = reader.getByTestId("book-focus");
  await expect(line).toContainText(BOOK_QUESTION);
  await expect(line).toContainText("Only this book until");
  // The reader reads as usual (its top bar stays), but no sitting can start inside a whole-book focus.
  await expect(view.getByRole("button", { name: "Contents" })).toBeVisible();
  await expect(view.getByRole("button", { name: "Focus session" })).toHaveCount(0);
  expect((await (await reader.request.get("/api/focus")).json()).session).toMatchObject({ kind: "book", bookId: tm, minutes: 3 * 1440, running: true, finished: false });
  expect((await reader.request.post("/api/focus", { data: { bookId: jekyll, question: "Another?", minutes: 5 } })).status()).toBe(409);

  // Home, Library, Search and another book go to this book's page, which names the focus.
  const bookPage = new RegExp(`/books/${tm}$`);
  for (const path of ["/", "/library", "/search", `/books/${jekyll}`, `/books/${jekyll}/read`]) {
    await reader.goto(path);
    await expect(reader, path).toHaveURL(bookPage);
    await expect(reader.getByTestId("book-focus-banner")).toContainText("The Time Machine");
  }
  // On a phone Daily review, Reading stats and Account sit in the menu on Home, which comes here: the banner links them.
  const banner = reader.getByTestId("book-focus-banner");
  for (const name of ["Read it", "Daily review", "Reading stats", "Account"]) await expect(banner.getByRole("link", { name })).toBeVisible();
  await banner.getByRole("link", { name: "Account" }).click();
  await expect(reader).toHaveURL(/\/account$/);
  await expect(reader.getByTestId("account-focus")).toContainText("A whole-book focus is running");
  // The pages that list no other book open. Daily review holds only this book's card (R5b).
  await reader.goto("/review");
  await expect(reader).toHaveURL(/\/review$/);
  await expect(reader.getByTestId("book-focus-banner")).toBeVisible();
  await expect(reader.getByTestId("review-card")).toContainText("The Time Machine");
  await expect(reader.getByTestId("review-progress")).toContainText("1 of 1");
  await reader.goto("/stats");
  await expect(reader).toHaveURL(/\/stats$/);
  // Another book's file is refused (423 Locked); this book's is not.
  expect((await reader.request.get(`/api/books/${jekyll}/file-link`)).status()).toBe(423);
  expect((await reader.request.get(`/api/books/${tm}/file-link`)).status()).toBe(200);

  // Leave early: 149 words are not enough; the wait starts, and Keep reading cancels it.
  await reader.goto(`/books/${tm}/read`);
  await ready();
  await line.getByRole("button", { name: "Leave early…" }).click();
  const leave = reader.getByTestId("book-focus-leave");
  await leave.getByLabel("Your answer").fill(words(149));
  await expect(leave.getByTestId("focus-leave-count")).toHaveText("149 of 150 words");
  await expect(leave.getByRole("button", { name: "Save the answer and leave" })).toBeDisabled();
  expect(
    (await reader.request.post(`/api/books/${tm}/focus`, { data: { focusId: (await (await reader.request.get("/api/focus")).json()).session.id, question: BOOK_QUESTION, answer: words(149) } })).status(),
  ).toBe(400);
  await leave.getByLabel("Your answer").fill(words(150));
  await expect(leave.getByRole("button", { name: "Save the answer and leave" })).toBeEnabled();
  await leave.getByRole("button", { name: /^Start the .* wait$/ }).click();
  await expect(reader.getByTestId("book-focus-wait")).toContainText("Leaving in");
  await line.getByRole("button", { name: "Keep reading" }).click();
  await expect(line).toContainText("Only this book until");
  expect((await (await reader.request.get("/api/focus")).json()).session.waitEndsAt).toBeNull();

  // The four looks: the reader with its line, and the book's page with the banner.
  await fourLooks(reader, "book-focus-reader", async () => {
    await ready();
    await expect(line).toBeVisible();
  });
  await reader.goto("/library");
  await expect(reader).toHaveURL(bookPage);
  await fourLooks(reader, "book-focus-page", async () => expect(reader.getByTestId("book-focus-banner")).toBeVisible());

  // The last page: the reader saves its place there, and the server says the book is finished; the question comes.
  await reader.goto(`/books/${tm}/read`);
  await ready();
  const fractions = await reader.evaluate(async () => {
    const v = document.querySelector("foliate-view") as HTMLElement & { goToFraction: (f: number) => Promise<void> };
    const seen: number[] = [];
    v.addEventListener("relocate", (e) => seen.push((e as CustomEvent<{ fraction: number }>).detail.fraction));
    await v.goToFraction(1);
    await new Promise((r) => setTimeout(r, 1000));
    return seen;
  });
  console.log(`The Time Machine's last page reports fraction ${JSON.stringify(fractions)}`);
  const end = reader.getByTestId("book-focus-end");
  await expect(end).toContainText("You reached the end. Did you answer it?", { timeout: 15_000 });
  await expect(end).toContainText(BOOK_QUESTION);
  // Read to its end: other books open at once, before the question is answered.
  expect((await (await reader.request.get("/api/focus")).json()).session).toMatchObject({ kind: "book", finished: true, running: false });
  expect((await reader.request.get(`/api/books/${jekyll}/file-link`)).status()).toBe(200);
  await end.getByLabel("Your answer").fill(BOOK_ANSWER);
  await end.getByRole("button", { name: "Save the answer" }).click();
  await expect(line).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Focus session" })).toBeVisible();
  expect((await (await reader.request.get("/api/focus")).json()).session).toBeNull();
  // The answer is a note on the book, with its question.
  const notes = (await (await reader.request.get(`/api/books/${tm}/annotations`)).json()).annotations as { kind: string; body: string }[];
  expect(notes.some((n) => n.kind === "note" && n.body.includes(BOOK_QUESTION) && n.body.includes("comfort without struggle"))).toBe(true);
  // Reading stats has a card for the focus: the book, how it ended, the reading done in it, the question and answer.
  await reader.goto("/stats");
  const card = reader.getByTestId("stats-book-focus");
  await expect(card).toContainText("The Time Machine");
  await expect(card.getByTestId("stats-book-focus-ended")).toContainText("Finished the book");
  await expect(card).toContainText(BOOK_QUESTION);
  await expect(card).toContainText("comfort without struggle");
  await expect(card).not.toContainText("Question:");
  await fourLooks(reader, "book-focus-stats", async () => {
    await expect(reader.getByTestId("stats-book-focus")).toBeVisible();
    await reader.getByRole("heading", { name: "Whole-book focus" }).scrollIntoViewIfNeeded();
    await reader.getByRole("heading", { name: "Whole-book focus" }).evaluate((h) => h.scrollIntoView({ block: "start" }));
  });
  // Other books open again, and their cards come back to Daily review.
  await reader.goto("/review");
  await expect(reader.getByTestId("review-progress")).toContainText("of 3");
  await reader.goto("/library");
  await expect(reader).toHaveURL(/\/library$/);
  await expect(reader.getByTestId("book-focus-banner")).toHaveCount(0);
  expect((await reader.request.get(`/api/books/${jekyll}/file-link`)).status()).toBe(200);
});
