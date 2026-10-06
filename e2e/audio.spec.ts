import { expect, test } from "@playwright/test";
import { expectHighlightKeepsUp } from "./listen";
import { ADMIN, ADMIN_STATE } from "./pages";

// M7 (a): reading aloud through the API, with the fake voice (AI_FAKE=1 in
// the test server). The player in the reader comes next.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

test("a paragraph is read aloud once, stored with word timings, and its audio is only for its owner", async ({ page, browser }) => {
  await page.goto(`/search?q=${encodeURIComponent('"lover of the sane and customary"')}`);
  const link = page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "lover" }).first();
  const href = (await link.getAttribute("href"))!;
  const [, bookId, cfi] = /\/books\/([0-9a-f-]{36})\/read\?at=(.+)$/.exec(href)!;

  const info = await (await page.request.get(`/api/books/${bookId}/audio?cfi=${cfi}`)).json();
  expect(info.voices).toEqual([
    { id: "fake-ada", name: "Ada (test voice)" },
    { id: "fake-ben", name: "Ben (test voice)" },
  ]);
  expect(info.track).toBeNull();
  expect(info.estimate).toBeGreaterThan(0);
  expect(info.passage.nextId).toEqual(expect.any(String));

  const made = await page.request.post(`/api/books/${bookId}/audio`, { data: { sectionId: info.passage.id, voice: "fake-ada" } });
  expect(made.status()).toBe(201);
  const { track } = await made.json();
  expect(track).toMatchObject({ sectionId: info.passage.id, voice: "fake-ada", mime: "audio/wav", provider: "elevenlabs", model: "fake-voice" });
  expect(track.words.length).toBeGreaterThan(50);
  expect(track.durationMs).toBeGreaterThan(1000);

  // Asked again: the stored track, no new audio.
  const again = await page.request.post(`/api/books/${bookId}/audio`, { data: { sectionId: info.passage.id, voice: "fake-ada" } });
  expect(again.status()).toBe(200);
  expect((await again.json()).track.id).toBe(track.id);
  expect((await (await page.request.get(`/api/books/${bookId}/audio?cfi=${cfi}&voice=fake-ada`)).json()).track.id).toBe(track.id);

  const audio = await page.request.get(track.audioUrl);
  expect(audio.status()).toBe(200);
  expect(audio.headers()["content-type"]).toBe("audio/wav");
  expect((await audio.body()).subarray(0, 4).toString()).toBe("RIFF");
  const size = Number(audio.headers()["content-length"]);
  expect(size).toBeGreaterThan(1000);
  expect(audio.headers()["accept-ranges"]).toBe("bytes");
  // Players ask for byte ranges to learn the length and to seek.
  const part = await page.request.get(track.audioUrl, { headers: { range: "bytes=0-3" } });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toBe(`bytes 0-3/${size}`);
  expect((await part.body()).toString()).toBe("RIFF");

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.get(new URL(track.audioUrl, page.url()).href)).status()).toBe(401);
  expect((await anon.request.post(new URL(`/api/books/${bookId}/audio`, page.url()).href, { data: {} })).status()).toBe(401);
  await anon.close();
  expect((await page.request.post(`/api/books/${bookId}/audio`, { data: { sectionId: info.passage.id, voice: "nobody" } })).status()).toBe(400);
});

const reader = (page: import("@playwright/test").Page) => page.getByTestId("reader");

async function openAtLover(page: import("@playwright/test").Page) {
  await page.goto(`/search?q=${encodeURIComponent('"lover of the sane and customary"')}`);
  await page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "lover" }).first().click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
}

/** The text the reader has highlighted as spoken, inside the book's frame. */
const spoken = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const h = (doc.defaultView as unknown as { CSS: { highlights: Map<string, Set<Range>> } }).CSS.highlights.get("nl-spoken");
      if (h) return [...h].map((r) => r.toString()).join(" ");
    }
    return null;
  });

const seek = (page: import("@playwright/test").Page, seconds: number) =>
  page.evaluate((s) => {
    const a = document.querySelector("audio")!;
    a.pause();
    a.currentTime = s;
  }, seconds);

test("the player reads aloud, highlights the word the timings say, and reads on to the next paragraph", async ({ page }) => {
  await openAtLover(page);
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  // The previous test already made this paragraph's audio in this voice.
  await expect(bar).toContainText("Saved audio: free to play.");
  await expect(bar.getByLabel("Voice")).toHaveValue("fake-ada");
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();

  // The fake voice speaks 0.03 s per character: "That evening, Mr. Utterson came home…"
  // "Utterson" starts at character 18 (0.54 s); "home" at character 32 (0.96 s).
  await seek(page, 0.6);
  await expect(bar).toHaveAttribute("data-word", "Utterson");
  expect(await spoken(page)).toBe("Utterson");
  await seek(page, 1.0);
  await expect(bar).toHaveAttribute("data-word", "home");
  expect(await spoken(page)).toBe("home");

  // A new voice needs new audio: the cost is shown first.
  await bar.getByLabel("Voice").selectOption("fake-ben");
  await expect(bar).toContainText(/This paragraph costs (about \$|under \$)[\d.]+ to read aloud; then it is saved\./);
  await bar.getByLabel("Voice").selectOption("fake-ada");
  await expect(bar).toContainText("Saved audio: free to play.");

  // At the end of the paragraph, the next one is made and played.
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.waitForFunction(() => Number.isFinite(document.querySelector("audio")!.duration));
  const made = page.waitForResponse((r) => r.url().endsWith("/audio") && r.request().method() === "POST" && r.status() === 201);
  await page.evaluate(() => {
    const a = document.querySelector("audio")!;
    a.currentTime = Math.max(0, a.duration - 0.05);
    void a.play();
  });
  const next = await (await made).json();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await seek(page, 0.01);
  expect(next.track.sectionId).not.toBe(undefined);
  await expect(bar).not.toHaveAttribute("data-word", "home");
  await expect(bar).toHaveAttribute("data-word", /\S+/);
  const word = await bar.getAttribute("data-word");
  expect(await spoken(page)).toBe(word);

  // Speed applies to the audio.
  await bar.getByLabel("Speed").selectOption("1.5");
  expect(await page.evaluate(() => document.querySelector("audio")!.playbackRate)).toBe(1.5);
  await bar.getByRole("button", { name: "Stop reading aloud" }).click();
  await expect(bar).toHaveCount(0);
  expect(await spoken(page)).toBeNull();
});

// Samuel (2026-10-04): the highlight did not keep up with the voice.
test("while playing, the highlight lands on every word in order, on time", async ({ page }) => {
  await openAtLover(page);
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar).toContainText("Saved audio: free to play.");
  await expectHighlightKeepsUp(page, "That evening, Mr. Utterson came home to his bachelor house in sombre spirits and sat down to dinner without relish.");
  await bar.getByRole("button", { name: "Stop reading aloud" }).click();
});

// M14 step 6a: one read-aloud player for the app. Leaving the reader, the audio goes on: the same
// element, its time still moving, never reloaded, emptied or paused. Back in the book, the bar is
// there again, and closing it stops the audio as before.
test("reading aloud goes on when the reader is left for Home, and the bar is back with the book", async ({ page }) => {
  await openAtLover(page);
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar).toContainText("Saved audio: free to play.");
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  // The paragraph is long enough (the fake voice: 0.03 s a character) to still be playing after the trip.
  await page.waitForFunction(() => {
    const a = document.querySelector("audio")!;
    return a.duration > 8 && a.currentTime > 0.2;
  });
  // From here on, anything that reloads, empties or pauses this element is counted.
  const before = await page.evaluate(() => {
    const a = document.querySelector("audio")!;
    const w = window as unknown as { heard: HTMLAudioElement; events: string[] };
    w.heard = a;
    w.events = [];
    for (const e of ["loadstart", "emptied", "abort", "pause"]) a.addEventListener(e, () => w.events.push(e));
    return a.currentTime;
  });

  await page.getByRole("link", { name: "Back to your library" }).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Read aloud" })).toHaveCount(0);
  await page.waitForFunction((t) => (document.querySelector("audio")?.currentTime ?? 0) > t + 0.5, before);
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { heard: HTMLAudioElement; events: string[] };
      const a = document.querySelector("audio");
      return { same: a === w.heard, paused: a?.paused, events: w.events, audios: document.querySelectorAll("audio").length };
    }),
  ).toEqual({ same: true, paused: false, events: [], audios: 1 });

  // A search moves within the app too: the same audio goes on.
  await page.getByRole("searchbox", { name: "Search your library" }).fill("Utterson");
  await page.getByRole("searchbox", { name: "Search your library" }).press("Enter");
  await expect(page).toHaveURL(/\/search\?q=Utterson$/);
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { heard: HTMLAudioElement; events: string[] };
      const a = document.querySelector("audio");
      return { same: a === w.heard, paused: a?.paused, events: w.events };
    }),
  ).toEqual({ same: true, paused: false, events: [] });

  // Back to the book: once it is open, its bar shows the audio still playing, and closing it stops it as before.
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const back = page.getByRole("region", { name: "Read aloud" });
  await expect(back.getByRole("button", { name: "Pause" })).toBeVisible();
  // ...and the book lights the word being read again.
  await expect(back).toHaveAttribute("data-word", /\S+/);
  await expect.poll(() => spoken(page)).toBeTruthy();
  await back.getByRole("button", { name: "Stop reading aloud" }).click();
  await expect(back).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { heard: HTMLAudioElement }).heard.isConnected)).toBe(false);
  expect(await spoken(page)).toBeNull();
});

// Opened but never played, Listen does not outlive the reader: coming back later, it would start
// from where it was opened, with audio links that have expired.
test("a Read aloud bar left without playing closes, and does not come back with the book", async ({ page }) => {
  await openAtLover(page);
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByRole("region", { name: "Read aloud" })).toContainText("Saved audio: free to play.");
  await page.getByRole("link", { name: "Back to your library" }).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("region", { name: "Read aloud" })).toHaveCount(0);
});

// Another book's reader has no bar for this one: opening it stops the reading, as leaving the reader did before.
test("opening another book stops the one being read aloud", async ({ page }) => {
  await openAtLover(page);
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  const jekyll = /\/books\/([0-9a-f-]{36})\/read/.exec(page.url())![1];
  await page.getByRole("button", { name: "1 link to your other books" }).click();
  await page.getByRole("region", { name: "Elsewhere in your library" }).getByRole("link", { name: "Open in Frankenstein" }).click();
  await expect(page).toHaveURL((url) => /\/books\/[0-9a-f-]{36}\/read/.test(url.pathname) && !url.pathname.includes(jekyll));
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Read aloud" })).toHaveCount(0);
});

// Signing out lands on the sign-in page, without a page load: nothing may play there.
// (A session of its own: signing it out leaves the other tests' session alone.)
test("signing out stops reading aloud", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await openAtLover(page);
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("link", { name: "Back to your library" }).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector("audio")?.paused)).toBe(false);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.locator("audio")).toHaveCount(0);
  await ctx.close();
});

test("the player is accessible, and looks right on phone and desktop, light and dark", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const { mkdir } = await import("node:fs/promises");
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await openAtLover(page);
      await page.getByRole("button", { name: "Listen" }).click();
      const bar = page.getByRole("region", { name: "Read aloud" });
      await expect(bar).toContainText("Saved audio");
      await bar.getByRole("button", { name: "Play" }).click();
      await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
      await seek(page, 0.6);
      await expect(bar).toHaveAttribute("data-word", "Utterson");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-listen-${name}-${scheme}.png` });
    }
  }
});

// M7: the running cost counter, after the AI and audio tests above have spent (fake) money.
test("the admin's cost counter shows this month's text and voice spending, by book", async ({ page }) => {
  await page.goto("/admin/invites");
  await page.getByRole("link", { name: "Spending this month" }).click();
  await expect(page.getByRole("heading", { name: "Spending this month" })).toBeVisible();
  const amount = async (provider: string) => Number((await page.getByTestId(`spent-${provider}`).textContent())!.replace("$", ""));
  expect(await amount("anthropic")).toBeGreaterThan(0);
  expect(await amount("elevenlabs")).toBeGreaterThan(0);
  await expect(page.getByTestId("cost-anthropic")).toContainText(/of \$20\.00/);
  await expect(page.getByTestId("cost-anthropic")).toContainText(/[1-9]\d* paid requests/);
  await expect(page.getByTestId("cost-elevenlabs")).toContainText(/[1-9]\d* paid requests?/);
  const jekyll = page.getByTestId("cost-books").locator("li").filter({ hasText: "The Strange Case of Dr. Jekyll and Mr. Hyde" });
  await expect(jekyll).toContainText(/Claude \$0\.\d+ · ElevenLabs \$0\.\d+/);
  await expect(jekyll).not.toContainText("$0.00");
});

test("M14 (6b): with a made voice, the mini-player shows where it was paused, and a skip while paused stays paused", async ({ page }) => {
  await openAtLover(page);
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar).toContainText("Saved audio: free to play.");
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.waitForFunction(() => Number.isFinite(document.querySelector("audio")!.duration));
  // Paused on "home" (the fake voice: 0.03 s a character; "home" from 0.96 s).
  await seek(page, 1.0);
  await expect(bar).toHaveAttribute("data-word", "home");
  await expect(bar.getByRole("button", { name: "Play" })).toBeVisible();

  await page.getByRole("link", { name: "Back to your library" }).click();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(mini.locator("mark")).toHaveText("home");
  await expect(mini.locator("p").first()).toContainText("Utterson came home");

  // Forward 15 s from near the paragraph's end: on to the next paragraph, ready and still paused.
  const first = await page.evaluate(() => {
    const a = document.querySelector("audio")!;
    a.currentTime = a.duration - 3;
    return a.src;
  });
  await mini.getByRole("button", { name: "Forward 15 seconds" }).click();
  await page.waitForFunction((src) => document.querySelector("audio")!.src !== src, first);
  expect(await page.evaluate(() => document.querySelector("audio")!.paused)).toBe(true);
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(mini.locator("p").first()).not.toContainText("Utterson came home");
  // Play reads it from its start.
  await mini.getByRole("button", { name: "Play", exact: true }).click();
  await expect(mini.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.waitForFunction(() => document.querySelector("audio")!.currentTime > 0.2);
});
