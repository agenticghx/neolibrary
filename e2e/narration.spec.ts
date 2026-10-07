import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { readableEpub } from "../lib/library/test-epub";
import { ADMIN_STATE } from "./pages";

// M14 follow-up V5: AI voice narration for an entire book, on the Import page, chosen on purpose
// (Samuel, 2026-10-06). With the FAKE voice only (AI_FAKE=1 in the test server): Samuel's rule is that
// no paid voice narrates a whole book until he says so. This project runs last (playwright.config.ts):
// it makes a book's audio in bulk and spends the fake voice's pretend money against the real limits
// ($5 per book and $20 per month, the defaults: the test server sets none).

test.use({ storageState: ADMIN_STATE });

/**
 * A book of 2,500 paragraphs, all different (a saved paragraph is found by its text, so a repeated one
 * would be made once), 6 characters each ("L0001."): 15,000 characters, $4.50 at $0.30 per 1,000. Under
 * the $5 per-book limit, so the first voice can finish; the second voice then meets the limit. The fake
 * voice makes about 250 short paragraphs a second here (2026-10-07, on the laptop), so this many make a
 * run of several seconds: long enough to be seen going on, photographed, and stopped. Invented text.
 */
const N = 2500;
/** Numbers as the page writes them: 2,500. */
const num = (x: number) => x.toLocaleString("en-US");
const NN = num(N);
const LINES = Array.from({ length: N }, (_, i) => `L${String(i + 1).padStart(4, "0")}.`);
const EACH = LINES[0].length;
const CHARS = LINES.reduce((sum, l) => sum + l.length, 0);
const TITLE = "Lamps Along the Quay";
const AUTHOR = "Iris Wick";
/** The app's default price (US dollars per 1,000 characters); the test server sets no ELEVENLABS_USD_PER_1K_CHARS. */
const cost = (characters: number) => (characters / 1000) * 0.3;
const dollars = (x: number) => `$${x.toFixed(2)}`;

type Summary = {
  voice: string;
  paragraphs: number;
  characters: number;
  saved: number;
  toMake: { paragraphs: number; characters: number };
  estimateUsd: number;
  caps: { perBookUsd: number; perMonthUsd: number; spentBookUsd: number; spentMonthUsd: number };
  stopsAt: number | null;
  running: boolean;
  stoppedBecause: { kind: string; message: string } | null;
};

/** Accessible, no sideways scroll on a phone, and a screenshot, in the four looks. */
async function fourLooks(page: Page, name: string) {
  mkdirSync("screenshots", { recursive: true });
  for (const [size, width, height] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((x) => x.target).join(", ")}`), `${name} ${size} ${scheme}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${name} ${size} ${scheme}: sideways scroll`).toBeLessThanOrEqual(0);
      await page.getByRole("region", { name: "Create AI voice narration for an entire book" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `screenshots/import-${name}-${size}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("M14 follow-up V5: whole-book narration is chosen on purpose, says what it costs first, and can be stopped; a spending limit stops it", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.goto("/import");
  await page.getByLabel("Choose files").setInputFiles({
    name: "lamps-along-the-quay.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from(readableEpub(TITLE, [`<h1>The lamps</h1>${LINES.map((l) => `<p>${l}</p>`).join("")}`], AUTHOR)),
  });
  await expect(page.getByTestId("upload-results").getByText("Added to your library")).toBeVisible();

  // Every request from the page that could make audio (the server makes the narration itself).
  const posts: string[] = [];
  page.on("request", (r) => {
    const at = new URL(r.url()).pathname;
    if (r.method() === "POST" && /^\/api\/books\/[^/]+\/(audio|narration)$/.test(at)) posts.push(at.split("/").at(-1)!);
  });

  const section = page.getByRole("region", { name: "Create AI voice narration for an entire book" });
  // EPUB only: the books offered are exactly the library's EPUBs with a file (the page updated itself after the upload).
  const exported = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string; author: string; file: { type: string } | null }[];
  const label = (b: { title: string; author: string }) => (b.author ? `${b.title}, by ${b.author}` : b.title);
  const bookSelect = section.getByLabel("Book to narrate");
  await expect
    .poll(async () => (await bookSelect.locator("option").allTextContents()).slice(1).sort())
    .toEqual(exported.filter((b) => b.file?.type === "epub").map(label).sort());
  const bookId = exported.find((b) => b.title === TITLE)!.id;
  const api = `/api/books/${bookId}/narration`;
  const summaryOf = async (voice = "fake-ada") => (await (await page.request.get(`${api}?voice=${voice}`)).json()) as Summary;

  await test.step("before anything is made, it names the whole book, its paragraphs and its cost, paid up front", async () => {
    await bookSelect.selectOption({ label: `${TITLE}, by ${AUTHOR}` });
    await expect(section.getByLabel("Voice", { exact: true })).toHaveValue("fake-ada");
    const summary = section.getByTestId("narration-summary");
    await expect(summary).toContainText(`This narrates the entire book, ${TITLE}: all 2,500 paragraphs (15,000 characters), in the voice Ada (test voice).`);
    expect([EACH, CHARS, dollars(cost(CHARS))]).toEqual([6, 15_000, "$4.50"]);
    await expect(summary).toContainText(
      "The whole book costs about $4.50, at $0.30 per 1,000 characters. It is paid up front: every paragraph is made and paid for now, not when you listen.",
    );
    await expect(summary).toContainText(/Your voice spending limits are \$5\.00 per book \(\$0\.00 spent on this book so far\) and \$20\.00 per month \(\$\d+\.\d\d spent this month\)\. They allow all of it\./);

    // Create stays disabled until "I understand…" is ticked.
    const agree = section.getByRole("checkbox", { name: "I understand this makes narration for the entire book and costs about $4.50" });
    const create = section.getByRole("button", { name: "Create narration" });
    await expect(agree).not.toBeChecked();
    await expect(create).toBeDisabled();
    await agree.check();
    await expect(create).toBeEnabled();
    await agree.uncheck();
    await expect(create).toBeDisabled();

    // The server refuses too, without confirm: true.
    for (const data of [{ voice: "fake-ada" }, { voice: "fake-ada", confirm: "yes" }]) {
      const refused = await page.request.post(api, { data });
      expect(refused.status()).toBe(400);
      expect((await refused.json()).error).toBe("Nothing was started: first confirm that this makes narration for the entire book, paid up front.");
    }
    // Nothing is made before Create.
    expect(posts).toEqual([]);
    expect(await summaryOf()).toMatchObject({ paragraphs: N, characters: CHARS, saved: 0, stopsAt: null, running: false, stoppedBecause: null });
    await fourLooks(page, "narration-summary");
  });

  let stoppedAt = 0;
  await test.step("Create starts it; the page opened again shows it going on; Stop stops it", async () => {
    await section.getByRole("checkbox", { name: "I understand this makes narration for the entire book and costs about $4.50" }).check();
    const t0 = Date.now();
    await section.getByRole("button", { name: "Create narration" }).click();
    await expect(section.getByRole("button", { name: "Stop", exact: true })).toBeFocused();
    expect(posts).toEqual(["narration"]);
    // It goes on in the background: the Import page, opened again, shows it (the book and voice chosen, the count, Stop).
    await page.reload();
    await expect(section.getByLabel("Book to narrate")).toHaveValue(bookId);
    await expect(section.getByRole("progressbar", { name: "Paragraphs saved" })).toBeVisible();
    await expect(section.getByTestId("narration-progress")).toHaveText(/^[\d,]+ of 2,500 paragraphs saved \((less than 1|\d+)%\)\.$/);
    await fourLooks(page, "narration-running");
    await expect(section.getByRole("progressbar", { name: "Paragraphs saved" })).toBeVisible();
    // Printed so a CI run shows how much room Stop had (the run must still be going when Stop is pressed).
    console.log(`[narration] Stop pressed ${Date.now() - t0} ms after Create, with ${(await summaryOf()).saved} of ${NN} paragraphs saved`);
    await section.getByRole("button", { name: "Stop", exact: true }).click();
    const status = section.getByTestId("narration-status");
    await expect(status).toContainText("Stopped, as you asked.");
    await expect(status).toBeFocused();
    const stopped = await summaryOf();
    expect(stopped).toMatchObject({ running: false, stoppedBecause: { kind: "stopped", message: "Stopped, as you asked." } });
    expect(stopped.saved).toBeGreaterThan(0);
    expect(stopped.saved).toBeLessThan(N);
    await expect(status).toHaveText(`Stopped, as you asked. ${num(stopped.saved)} of ${NN} paragraphs are saved, and play for free.`);
    // Stopped means stopped: nothing more is made.
    await page.waitForTimeout(1000);
    expect((await summaryOf()).saved).toBe(stopped.saved);
    stoppedAt = stopped.saved;
  });

  await test.step("continuing pays only for the rest; the progress rises to the end", async () => {
    const left = cost(CHARS - stoppedAt * EACH);
    await expect(section.getByTestId("narration-summary")).toContainText(
      `${num(stoppedAt)} of its paragraphs are already saved in this voice and are not paid for again, so what is left (${num(N - stoppedAt)} paragraphs) costs about ${dollars(left)}.`,
    );
    const go = section.getByRole("button", { name: "Continue narration" });
    await expect(go).toBeDisabled();
    await section.getByRole("checkbox", { name: `I understand this makes narration for the entire book and costs about ${dollars(left)}` }).check();
    const t1 = Date.now();
    await go.click();
    await expect(section.getByRole("progressbar", { name: "Paragraphs saved" })).toBeVisible();
    // The count, asked for every 100 ms until it ends: it rises, step by step, to every paragraph.
    const seen: number[] = [];
    await expect
      .poll(
        async () => {
          const s = await summaryOf();
          if (s.running) seen.push(s.saved);
          return s.stoppedBecause?.kind ?? "running";
        },
        { intervals: [100], timeout: 120_000 },
      )
      .toBe("finished");
    const counts = [...new Set(seen)];
    console.log(`[narration] the rest (${num(N - stoppedAt)} paragraphs) took ${Date.now() - t1} ms; ${counts.length} different counts seen`);
    expect(counts.length, `counts seen while it ran: ${counts.join(", ")}`).toBeGreaterThanOrEqual(2);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0]).toBeGreaterThanOrEqual(stoppedAt);
    await expect(section.getByTestId("narration-status")).toHaveText(
      "Done: all 2,500 paragraphs are saved in the voice Ada (test voice). Open the book and press Listen: it plays for free.",
    );
    await expect(section.getByTestId("narration-summary")).toHaveCount(0);
    const done = await summaryOf();
    expect(done).toMatchObject({ saved: N, toMake: { paragraphs: 0, characters: 0 }, estimateUsd: 0, stoppedBecause: { kind: "finished" } });
    // No paragraph was paid for twice (the ones saved before Stop were skipped): this book's spending is the book's cost, once.
    expect(done.caps.spentBookUsd).toBeCloseTo(cost(CHARS), 6);
    expect(posts).toEqual(["narration", "narration"]);
  });

  await test.step("a spending limit stops it in its own words, where the page said it would", async () => {
    // Ben has nothing saved; the book has $5.00 − $4.50 = $0.50 left under its limit: room for 277 paragraphs of $0.0018.
    const fits = Math.floor((5 - cost(CHARS)) / cost(EACH));
    expect(fits).toBe(277);
    await section.getByLabel("Voice", { exact: true }).selectOption("fake-ben");
    const summary = section.getByTestId("narration-summary");
    await expect(summary).toContainText("in the voice Ben (test voice)");
    await expect(summary).toContainText(
      `They would stop it at about ${Math.round((100 * fits) / N)}% of the book, with about ${num(fits)} of the ${NN} paragraphs saved. Only the library's owner can raise the limits, in Railway (VOICE_CAP_PER_BOOK_USD and VOICE_CAP_PER_MONTH_USD).`,
    );
    expect(await summaryOf("fake-ben")).toMatchObject({ voice: "fake-ben", saved: 0, stopsAt: fits });
    await section.getByRole("checkbox", { name: "I understand this makes narration for the entire book and costs about $4.50" }).check();
    await section.getByRole("button", { name: "Create narration" }).click();
    const status = section.getByTestId("narration-status");
    await expect(status).toContainText("Stopped by a spending limit: “This book's voice spending cap ($5.00) has been reached", { timeout: 60_000 });
    const capped = await summaryOf("fake-ben");
    expect(capped).toMatchObject({ running: false, saved: fits, stoppedBecause: { kind: "limit" } });
    expect(capped.stoppedBecause!.message).toMatch(/^This book's voice spending cap \(\$5\.00\) has been reached \(\$\d\.\d\d spent\)\. The owner can raise VOICE_CAP_PER_BOOK_USD\.$/);
    await expect(status).toHaveText(`Stopped by a spending limit: “${capped.stoppedBecause!.message}” ${num(fits)} of ${NN} paragraphs are saved, and play for free.`);
    // With no room left under the limit, nothing is offered: the page says why, and who can raise the limit.
    await expect(summary).toContainText(
      "They leave no room for another paragraph, so nothing can be made now. Only the library's owner can raise the limits, in Railway (VOICE_CAP_PER_BOOK_USD and VOICE_CAP_PER_MONTH_USD).",
    );
    await expect(section.getByRole("button", { name: /narration$/ })).toHaveCount(0);
    await expect(section.getByRole("checkbox")).toHaveCount(0);
    expect(posts).toEqual(["narration", "narration", "narration"]);
    await fourLooks(page, "narration-limit");
  });

  await test.step("only for the book's owner, signed in, and EPUB only", async () => {
    const pdf = exported.find((b) => b.file?.type === "pdf")!;
    const refused = await page.request.get(`/api/books/${pdf.id}/narration`);
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toBe("Only an EPUB can be narrated by an AI voice: a voice cannot be lined up with a PDF page yet.");
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    expect((await anon.request.get(api)).status()).toBe(401);
    expect((await anon.request.post(api, { data: { voice: "fake-ada", confirm: true } })).status()).toBe(401);
    await anon.close();
    // Grace (made by uploads.spec.ts) is another reader: the book is not found for her, and nothing starts.
    const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const grace = await other.newPage();
    await grace.goto("/sign-in");
    await grace.getByLabel("Email address").fill("grace@example.com");
    await grace.getByLabel("Password").fill("a long password here");
    await grace.getByRole("button", { name: "Sign in" }).click();
    await expect(grace.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    expect((await grace.request.get(`${api}?voice=fake-ben`)).status()).toBe(404);
    expect((await grace.request.post(api, { data: { voice: "fake-ben", confirm: true } })).status()).toBe(404);
    expect((await grace.request.delete(`${api}?voice=fake-ben`)).status()).toBe(404);
    await other.close();
    expect(await summaryOf("fake-ben")).toMatchObject({ running: false, saved: 277 });
  });
});
