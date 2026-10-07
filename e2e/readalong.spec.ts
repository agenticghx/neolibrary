import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { extractPdfSections } from "@/lib/library/pdf-sections";
import { extractSections, type Section } from "@/lib/library/sections";
import { LOOK_BACK_MS } from "@/lib/player/session";
import { buildPackage, SECONDS_PER_CHAR } from "@/lib/readalong/fixture";
import { SKIP_GAP_MS, WORD_TAIL_MS } from "@/lib/readalong/player";
import { expectEveryWordOnTime, expectNoStall, instrument, recording, recordPlayer, reportTiming, type Spoken } from "./listen";
import { ADMIN_STATE, TEST_MAX_RANGE } from "./pages";

// M13 (c2): uploading a read-along package through the real server: the
// package without its audio, the audio in parts, then finishing. The package
// is built in code from the same Jekyll and Hyde file the uploads test added.

test.use({ storageState: ADMIN_STATE });
// No offline service worker here: in WebKit, Playwright cannot hold (page.route)
// requests from a page a service worker controls, and these tests need to.
test.use({ serviceWorkers: "block" });
// One after another: every test here changes the same book's audiobook.
test.describe.configure({ mode: "serial" });

/** "-safari" for the WebKit run, so its screenshots do not overwrite Chrome's. */
const engine = () => (test.info().project.name.includes("safari") ? "-safari" : "");

/**
 * Chooses a folder in a folder picker as a reader does: the browser lists the folder itself (each file's
 * path inside it comes from the engine), then fires "input" and "change". Playwright 1.56 waits for that
 * "input", but asks the page to listen for it only after handing the folder over
 * (playwright-core/lib/server/dom.js, _setInputFiles). WebKit lists the folder in the background and can
 * fire "input" before anyone listens; setInputFiles then never returns, though the page has done its work
 * (CI run 37392862541, attempt 2: the page said "Done." and the call hung until the 2-minute test timeout).
 * So once the status line shows the page took the folder, one more "input" ends that wait. The page cannot
 * react to it: React's onChange on a file field listens to "change" only. A second upload would fail the
 * "announced once" checks below.
 */
async function chooseFolder(section: Locator, label: string, dir: string) {
  // Found by what it is, not by its label: "Choose the read-along folder" reads "Replace with another
  // folder" once a reading is ready, which can be before the event below is sent.
  const field = section.locator("input[webkitdirectory]");
  await Promise.all([
    section.getByLabel(label).setInputFiles(dir, { timeout: 30_000 }),
    (async () => {
      // Any step of an upload, or already "Done." (a small package can finish before the first look).
      await expect(section.getByTestId("audiobook-status")).toHaveText(/^(Checking |Sending |Done\.$)/, { timeout: 20_000 });
      await field.dispatchEvent("input", undefined, { timeout: 5_000 });
    })(),
  ]);
}

const BOOK = new Uint8Array(readFileSync("fixtures/books/stevenson-jekyll-and-hyde.epub"));

test("an audiobook package is uploaded in parts, checked, and becomes read-aloud tracks; it can be removed", async ({ page }) => {
  await page.goto("/library");
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  const bookId = books.find((b) => b.title.startsWith("The Strange Case"))!.id;
  const paragraphs = extractSections(BOOK).filter((s) => s.kind === "paragraph").slice(20, 23);
  const { files } = buildPackage({
    bookBytes: BOOK,
    chapters: [{ title: "Chapter", paragraphs: ["Chapter Three.", ...paragraphs.map((p) => p.text)], inBook: [null, ...paragraphs.map((p) => p.chapterIndex)] }],
  });
  const zip = zipSync(Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith("audio/"))));

  // Not signed in: refused.
  const anon = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.post(new URL(`/api/books/${bookId}/readalong`, page.url()).href, { data: Buffer.from(zip) })).status()).toBe(401);
  await anon.close();

  const started = await page.request.post(`/api/books/${bookId}/readalong`, { data: Buffer.from(zip), headers: { "content-type": "application/zip" } });
  expect(started.status()).toBe(201);
  const { import: imp, partBytes } = await started.json();
  expect(imp).toMatchObject({ status: "uploading", waitingFor: ["audio/01.wav"], report: { paragraphs: 3 } });
  expect(partBytes).toBe(8 * 1024 * 1024);

  const audio = files["audio/01.wav"];
  const put = async (n: number, bytes: Uint8Array) => {
    const res = await page.request.put(`/api/books/${bookId}/readalong/${imp.id}/parts?file=${encodeURIComponent("audio/01.wav")}&part=${n}`, { data: Buffer.from(bytes) });
    expect(res.status()).toBe(200);
    return res.json();
  };
  // Two small parts are refused when joined, as the bucket refuses parts under 5 MB (all but the last).
  const half = Math.floor(audio.byteLength / 2);
  const halves = [await put(1, audio.slice(0, half)), await put(2, audio.slice(half))];
  const refused = await page.request.post(`/api/books/${bookId}/readalong/${imp.id}/finish`, { data: { parts: { "audio/01.wav": halves } } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toBe("audio/01.wav could not be put together: a part before the last is smaller than 5 MB (the storage's minimum).");
  // One part (the last part may be any size) is accepted.
  const parts = [await put(1, audio)];
  const finished = await page.request.post(`/api/books/${bookId}/readalong/${imp.id}/finish`, { data: { parts: { "audio/01.wav": parts } } });
  expect(finished.status()).toBe(200);
  expect((await finished.json()).import).toMatchObject({ id: imp.id, status: "ready", waitingFor: [] });

  const exported = await (await page.request.get("/api/export")).json();
  const uploaded = exported.audioTracks
    .filter((t: { importId: string | null }) => t.importId === imp.id)
    .sort((a: { audioStartMs: number }, b: { audioStartMs: number }) => a.audioStartMs - b.audioStartMs);
  expect(uploaded.map((t: { sectionId: string }) => t.sectionId)).toEqual(paragraphs.map((p) => p.id));
  expect(uploaded[0]).toMatchObject({ source: "upload", mime: "audio/wav", audioStartMs: expect.any(Number), audioEndMs: expect.any(Number) });

  // A package made from a different file of the book is refused, in plain words.
  const other = buildPackage({ bookBytes: new Uint8Array([1, 2, 3]), chapters: [{ title: "x", paragraphs: [paragraphs[0].text], inBook: [paragraphs[0].chapterIndex] }] });
  const wrong = await page.request.post(`/api/books/${bookId}/readalong`, { data: Buffer.from(other.zip()) });
  expect(wrong.status()).toBe(400);
  expect((await wrong.json()).error).toMatch(/made from a different file of this book/);

  expect((await page.request.get(`/api/books/${bookId}/readalong`)).ok()).toBe(true);
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
  const after = await (await page.request.get("/api/export")).json();
  expect(after.audioTracks.filter((t: { importId: string | null }) => t.importId === imp.id)).toEqual([]);
  expect((await (await page.request.get(`/api/books/${bookId}/readalong`)).json()).imports).toEqual([]);
});

// Next.js runs proxy.ts (the sign-in gatekeeper) on every request, and by
// default it passes on at most 10 MB of a request body. A package zip with
// its audio inside can be larger, so this sends one of about 12 MB.
test("a package .zip larger than 10 MB, audio inside, arrives whole", async ({ page }) => {
  await page.goto("/library");
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  const bookId = books.find((b) => b.title.startsWith("The Strange Case"))!.id;
  const paragraphs = extractSections(BOOK).filter((s) => s.kind === "paragraph").slice(40, 140);
  const { files } = buildPackage({
    bookBytes: BOOK,
    chapters: [{ title: "Long", paragraphs: paragraphs.map((p) => p.text), inBook: paragraphs.map((p) => p.chapterIndex) }],
  });
  const zip = zipSync(files, { level: 0 });
  expect(zip.byteLength).toBeGreaterThan(10 * 1024 * 1024 + 1);
  const res = await page.request.post(`/api/books/${bookId}/readalong`, { data: Buffer.from(zip), headers: { "content-type": "application/zip" } });
  const body = await res.json();
  expect(body.error ?? null).toBeNull();
  expect(res.status()).toBe(201);
  expect(body.import.status).toBe("ready");
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${body.import.id}`)).status()).toBe(204);
});

// The same 10 MB cut applied to book uploads (the shelf allows books up to
// 200 MB): a 12 MB EPUB, the Jekyll and Hyde file padded with an unused file.
test("a book file larger than 10 MB uploads whole", async ({ page }) => {
  await page.goto("/library");
  const padded = unzipSync(BOOK);
  padded["OEBPS/padding.bin"] = Uint8Array.from({ length: 12 * 1024 * 1024 }, (_, i) => (i * 2654435761) >>> 24);
  const epub = zipSync(padded, { level: 0 });
  expect(epub.byteLength).toBeGreaterThan(10 * 1024 * 1024 + 1);
  const res = await page.request.post("/api/books", {
    multipart: { files: { name: "padded-jekyll.epub", mimeType: "application/epub+zip", buffer: Buffer.from(epub) } },
  });
  const body = await res.json();
  expect(body.results?.[0] ?? body).toMatchObject({ file: "padded-jekyll.epub" });
  expect(["added", "attached", "duplicate"]).toContain((body.results?.[0] ?? body).status);
});

// M13 (c3): the "Your audiobook" section on the book's page.
test("the book page takes a read-along folder, shows each step and the result, looks right, and removes it", async ({ page }) => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const imports = async (bookId: string) => (await (await page.request.get(`/api/books/${bookId}/readalong`)).json()).imports as { status: string; title: string }[];

  await page.goto("/library");
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  const bookId = books.find((b) => b.title.startsWith("The Strange Case"))!.id;
  const paragraphs = extractSections(BOOK).filter((s) => s.kind === "paragraph").slice(10, 14);
  const { files, zip } = buildPackage({
    bookBytes: BOOK,
    title: "Jekyll test reading",
    chapters: [{ title: "Story of the Door", paragraphs: ["Chapter One.", ...paragraphs.map((p) => p.text)], inBook: [null, ...paragraphs.map((p) => p.chapterIndex)] }],
  });
  // The folder the readalong-audio skill would have made, written to disk.
  const root = path.join(await mkdtemp(path.join(tmpdir(), "readalong-")), "jekyll-readalong");
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes);
  }

  await page.goto(`/books/${bookId}`);
  const section = page.getByRole("region", { name: "Your audiobook" });
  await expect(section).toContainText("Add an audiobook of this book to read along with it");
  await expect(section).toContainText("Then press Listen in the book to play it.");
  const empty = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(empty.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);

  // Record every step the status line announces.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const t = document.querySelector('[data-testid="audiobook-status"]')?.textContent ?? "";
      if (t && seen.at(-1) !== t) seen.push(t);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const folder = section.getByLabel("Choose the read-along folder");
  await expect(folder).toHaveAttribute("webkitdirectory", "");
  await chooseFolder(section, "Choose the read-along folder", root);
  await expect(section.getByTestId("audiobook-status")).toHaveText("Done.");
  await expect(section).toContainText("Ready · added");
  await expect(section).toContainText("To read along, open the book and press Listen");
  await expect(section.getByTestId("audiobook-placed")).toContainText(/[\d,]+ of [\d,]+ spoken words placed on the page \(\d+%\) in 1 chapter\./);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen[0]).toBe("Checking the package against this book…");
  expect(seen).toContain("Checking the audio on this computer (2 MB)…");
  expect(seen.some((s) => /^Sending the audio \(\d+ MB\)\. This can take a few minutes; keep this page open\.$/.test(s))).toBe(true);
  expect(seen).toContain("Checking the audio and saving the timings…");
  expect(seen.at(-1)).toBe("Done.");
  // The steps are announced once each, not once per 8 MB part.
  expect(seen.filter((s) => s.startsWith("Sending")).length).toBe(1);
  // Keyboard focus goes back to the section, not the top of the page.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("audiobook");
  expect(await imports(bookId)).toMatchObject([{ status: "ready", title: "Jekyll test reading" }]);

  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/book-audiobook-${name}-${scheme}${engine()}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });

  // A package made from another file of the book is refused in plain words, and the good one stays.
  const other = buildPackage({ bookBytes: new Uint8Array([1, 2, 3]), chapters: [{ title: "x", paragraphs: [paragraphs[0].text], inBook: [paragraphs[0].chapterIndex] }] });
  await section.getByLabel("or a .zip of it (up to 50 MB)").setInputFiles({ name: "other.zip", mimeType: "application/zip", buffer: Buffer.from(other.zip()) });
  await expect(section.getByRole("alert")).toContainText("made from a different file of this book");
  expect(await imports(bookId)).toMatchObject([{ status: "ready", title: "Jekyll test reading" }]);

  // Replace: the same folder with a new title takes the old one's place.
  const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  await writeFile(path.join(root, "manifest.json"), JSON.stringify({ ...manifest, title: "Second reading" }));
  await chooseFolder(section, "Replace with another folder", root);
  await expect(section).toContainText("Second reading");
  await expect(section.getByRole("alert")).toHaveCount(0);
  expect(await imports(bookId)).toMatchObject([{ status: "ready", title: "Second reading" }]);

  // Remove: the section says so and is back to its empty state.
  await section.getByRole("button", { name: "Remove Second reading" }).click();
  await expect(section.getByTestId("audiobook-status")).toHaveText("Removed Second reading: its audio and word timings are gone from this book.");
  await expect(section).toContainText("Add an audiobook of this book to read along with it");
  await expect(section.getByRole("alert")).toHaveCount(0);
  expect(await imports(bookId)).toEqual([]);

  // An upload that never finished (here: started without its audio) is shown honestly and can be removed.
  await page.request.post(`/api/books/${bookId}/readalong`, {
    data: Buffer.from(zipSync(Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith("audio/"))))),
    headers: { "content-type": "application/zip" },
  });
  await page.reload();
  await expect(section).toContainText(/An upload from \d+ \w+ \d{4} did not finish and cannot be continued\./);
  await section.getByRole("button", { name: /^Remove the unfinished upload from / }).click();
  await expect(section).not.toContainText("did not finish");
  expect(await imports(bookId)).toEqual([]);

  // The .zip route (for phones): a small package with its audio inside.
  await section.getByLabel("or a .zip of it (up to 50 MB)").setInputFiles({ name: "jekyll-readalong.zip", mimeType: "application/zip", buffer: Buffer.from(zip()) });
  await expect(section).toContainText("Ready · added");
  await section.getByRole("button", { name: "Remove Jekyll test reading" }).click();
  await expect(section).not.toContainText("Ready · added");
  expect(await imports(bookId)).toEqual([]);
});

// The checks above use a 2 MB package (one part). These use one big enough
// for two 8 MB parts, a slowed-down network to see the steps, and the PDF.
test("a two-part upload is announced once, can be cancelled, and the PDF book page says to press Listen", async ({ page }) => {
  test.setTimeout(120_000);
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  await page.goto("/library");
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string; fileType?: string }[];
  const bookId = books.find((b) => b.title.startsWith("The Strange Case"))!.id;
  const paragraphs = extractSections(BOOK).filter((s) => s.kind === "paragraph").slice(40, 140);
  const { files, zip } = buildPackage({
    bookBytes: BOOK,
    title: "Long reading",
    chapters: [{ title: "Long", paragraphs: paragraphs.map((p) => p.text), inBook: paragraphs.map((p) => p.chapterIndex) }],
  });
  expect(files["audio/01.wav"].byteLength).toBeGreaterThan(8 * 1024 * 1024); // two parts
  const root = path.join(await mkdtemp(path.join(tmpdir(), "readalong-long-")), "long-readalong");
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes);
  }
  await page.goto(`/books/${bookId}`);
  const section = page.getByRole("region", { name: "Your audiobook" });
  await page.evaluate(() => {
    const w = window as unknown as { said: string[]; sent: string[] };
    w.said = [];
    w.sent = [];
    new MutationObserver(() => {
      const said = document.querySelector('[data-testid="audiobook-status"]')?.textContent ?? "";
      const sent = document.querySelector('[data-testid="audiobook-sent"]')?.textContent ?? "";
      if (said && w.said.at(-1) !== said) w.said.push(said);
      if (sent && w.sent.at(-1) !== sent) w.sent.push(sent);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  // One rule for the whole test (WebKit does not pick up a rule added again
  // after page.unroute in time): each phase sets how long parts are held.
  let partDelay = 400; // slow enough to see the running count
  let zipDelay = 0;
  await page.route("**/readalong/*/parts?*", async (route) => {
    await new Promise((r) => setTimeout(r, partDelay));
    await route.continue().catch(() => {});
  });
  await page.route("**/api/books/*/readalong", async (route) => {
    if (route.request().method() === "POST" && zipDelay) await new Promise((r) => setTimeout(r, zipDelay));
    await route.continue();
  });
  await chooseFolder(section, "Choose the read-along folder", root);
  await expect(section.getByTestId("audiobook-status")).toHaveText("Done.", { timeout: 20_000 });
  const { said, sent } = await page.evaluate(() => window as unknown as { said: string[]; sent: string[] }).then(async () =>
    page.evaluate(() => {
      const w = window as unknown as { said: string[]; sent: string[] };
      return { said: w.said, sent: w.sent };
    }),
  );
  expect(said.filter((s) => s.startsWith("Sending the audio")).length).toBe(1); // announced once
  expect(sent[0]).toMatch(/^0 of \d+ MB sent$/); // the count moved from nothing...
  expect(sent).toContainEqual(expect.stringMatching(/^8 of \d+ MB sent$/)); // ...past the first 8 MB part...
  expect(sent.at(-1)).toMatch(/^All \d+ MB sent$/); // ...to the end, while the server checked the audio
  await section.getByRole("button", { name: "Remove Long reading" }).click();
  await expect(section.getByTestId("audiobook-status")).toHaveText("Removed Long reading: its audio and word timings are gone from this book.");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("audiobook");
  // Removing also refreshes the page (router.refresh in AudiobookUpload's settle), a navigation of its own that
  // can land after the message and the focus: leaving before it has finished made WebKit on CI report
  // "Navigation to /library?new=collection is interrupted by another navigation to /books/…" (three runs,
  // 2026-10-07). Wait for the refresh's fetch to end first.
  await page.waitForLoadState("networkidle");

  // A collection, so the page can be refreshed during the next upload (below).
  const collection = `Refresh test ${Date.now()}`;
  await page.goto("/library?new=collection");
  await page.getByLabel("Collection name").fill(collection);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/library\?c=/);
  const collectionUrl = page.url();
  await page.goto(`/books/${bookId}`);

  // Cancel in the middle of sending: the page says so, and the unfinished upload can be removed.
  partDelay = 20_000; // held while the screen is checked, then cancelled
  await chooseFolder(section, "Choose the read-along folder", root);
  const cancel = section.getByRole("button", { name: "Cancel the upload" });
  // Wait until the audio is being sent (the upload exists on the server).
  await expect(section.getByTestId("audiobook-status")).toHaveText(/^Sending the audio/);
  await expect(cancel).toBeVisible();
  // A refresh of the page while it sends (here: the book put in a collection; on the Import page:
  // a book added) lists the running upload as uploading. It is running, not one that "did not finish".
  const inCollection = page.getByRole("button", { name: collection, exact: true });
  await expect(inCollection).toHaveAttribute("aria-pressed", "false");
  await inCollection.click();
  await expect(inCollection).toHaveAttribute("aria-pressed", "true"); // the refresh has arrived
  await expect(section).not.toContainText("did not finish");
  await expect(cancel).toBeVisible();
  // The screen during an upload: accessible, no sideways scrolling, in four looks.
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300); // let the colour change for light/dark finish before checking contrast
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/book-audiobook-sending-${name}-${scheme}${engine()}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await cancel.click();
  await expect(section.getByRole("alert")).toHaveText("The upload was cancelled.");
  await expect(section).toContainText("did not finish and cannot be continued");
  partDelay = 0;
  await section.getByRole("button", { name: /^Remove the unfinished upload from / }).click();
  await expect(section).not.toContainText("did not finish");

  // The .zip route shows its step and a busy bar while it sends.
  zipDelay = 1500;
  await section.getByLabel("or a .zip of it (up to 50 MB)").setInputFiles({ name: "long.zip", mimeType: "application/zip", buffer: Buffer.from(zip()) });
  await expect(section.getByTestId("audiobook-status")).toHaveText(/^Sending the \.zip \(\d+ MB\)\. This can take a few minutes; keep this page open\.$/);
  await expect(section.getByRole("progressbar", { name: "Sending the .zip" })).toBeVisible();
  await expect(section.getByTestId("audiobook-status")).toHaveText("Done.", { timeout: 20_000 });
  zipDelay = 0;
  await section.getByRole("button", { name: "Remove Long reading" }).click();
  await expect(section).not.toContainText("Ready · added");

  // A PDF book plays its audiobook too (M13 (e)): the page says to press Listen.
  const pdf = books.find((b) => b.title === "Discourse on the Method")!;
  await page.goto(`/books/${pdf.id}`);
  await expect(page.getByRole("region", { name: "Your audiobook" })).toContainText("Then press Listen in the book to play it.");
  await page.goto(collectionUrl);
  await page.getByRole("button", { name: "Delete collection" }).click();
  await expect(page).toHaveURL(/\/library$/);
});

// The upload routes skip proxy.ts (so large bodies are not cut at 10 MB);
// they must still refuse a signed-out upload, before reading it.
test("a signed-out upload of 12 MB is refused by the upload routes themselves", async ({ page, browser }) => {
  await page.goto("/library");
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  const bookId = books.find((b) => b.title.startsWith("The Strange Case"))!.id;
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const big = Buffer.alloc(12 * 1024 * 1024, 7);
  const base = new URL("/", page.url()).href;
  const book = await anon.request.post(`${base}api/books`, { multipart: { files: { name: "x.epub", mimeType: "application/epub+zip", buffer: big } } });
  expect(book.status()).toBe(401);
  const pkg = await anon.request.post(`${base}api/books/${bookId}/readalong`, { data: big, headers: { "content-type": "application/zip" } });
  expect(pkg.status()).toBe(401);
  const part = await anon.request.put(`${base}api/books/${bookId}/readalong/${crypto.randomUUID()}/parts?file=a&part=1`, { data: big });
  expect(part.status()).toBe(401);
  // Every other route still goes through the sign-in check in proxy.ts.
  expect((await anon.request.get(`${base}api/export`)).status()).toBe(401);
  await anon.close();
});

// M13 (d): playing the uploaded audiobook in the reader. Each test imports
// its own package (replacing the last). After every test, passed or failed,
// the book's audiobooks are removed, so the tests after it (and a rerun
// against the same local server, where audio.spec.ts expects only the
// made-on-demand voices) see the book without one.
test.afterEach(async ({ page }) => {
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  const bookId = books.find((b) => b.title.startsWith("The Strange Case"))?.id;
  if (!bookId) return;
  const { imports } = (await (await page.request.get(`/api/books/${bookId}/readalong`)).json()) as { imports: { id: string }[] };
  for (const i of imports) await page.request.delete(`/api/books/${bookId}/readalong/${i.id}`);
});

const PARAGRAPHS = extractSections(BOOK).filter((s) => s.kind === "paragraph");

/** What the audiobook says: a book paragraph (by index), or words the book does not print (a spoken heading, an aside). */
type Said = number | string;

/**
 * A package reading `said` aloud, one audio file per chapter, and the words
 * the player should light up: those of the book's paragraphs, with when
 * each starts in its file (from the package's own timings).
 */
function readAlong(chapters: { title: string; said: Said[]; notSpoken?: string[] }[], title = "Test reading") {
  const text = (x: Said) => (typeof x === "number" ? PARAGRAPHS[x].text : x);
  const pkg = buildPackage({
    bookBytes: BOOK,
    title,
    chapters: chapters.map((c) => {
      const tokens = c.said.flatMap((x) => text(x).match(/\S+/g)!);
      return {
        title: c.title,
        paragraphs: c.said.map(text),
        inBook: c.said.map((x) => (typeof x === "number" ? PARAGRAPHS[x].chapterIndex : null)),
        notSpoken: (c.notSpoken ?? []).map((w) => {
          expect(tokens.filter((t) => t === w), `"${w}" once in the chapter`).toHaveLength(1);
          return tokens.indexOf(w);
        }),
      };
    }),
  });
  const expected: Spoken[] = [];
  chapters.forEach((c, file) => {
    const timings = JSON.parse(Buffer.from(pkg.files[`timings/${String(file + 1).padStart(2, "0")}.json`]).toString()).words as {
      w: string;
      start: number | null;
      source: string;
    }[];
    let i = 0;
    for (const x of c.said) {
      const words = timings.slice(i, (i += text(x).match(/\S+/g)!.length));
      if (typeof x !== "number") continue;
      for (const w of words) if (w.source === "aligned") expected.push({ word: w.w, startMs: Math.round(w.start! * 1000), file, cfi: PARAGRAPHS[x].cfi });
    }
  });
  return { ...pkg, expected };
}

async function jekyllId(page: Page) {
  await page.goto("/library");
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  return books.find((b) => b.title.startsWith("The Strange Case"))!.id;
}

/** Imports a package with its audio inside; checks the server placed exactly the expected words, at the expected times. */
async function importReading(page: Page, bookId: string, zip: Uint8Array, expected: Spoken[]) {
  const res = await page.request.post(`/api/books/${bookId}/readalong`, { data: Buffer.from(zip), headers: { "content-type": "application/zip" } });
  const body = await res.json();
  expect(body.error ?? null).toBeNull();
  expect(body.import.status).toBe("ready");
  const first = PARAGRAPHS.find((p) => p.cfi === expected[0].cfi)!;
  const info = await (await page.request.get(`/api/books/${bookId}/audio?${new URLSearchParams({ cfi: first.cfi })}`)).json();
  const placed = (info.audiobook.paragraphs as { sectionId: string; cfi: string; file: number; words: [number, number, number, number][] }[]).flatMap((p) =>
    p.words.map(([startMs, , from, to]) => ({ word: PARAGRAPHS.find((x) => x.id === p.sectionId)!.text.slice(from, to), startMs, file: p.file, cfi: p.cfi })),
  );
  expect(placed).toEqual(expected);
  return { id: body.import.id as string, info };
}

async function openListening(page: Page, bookId: string, at: number) {
  await page.goto(`/books/${bookId}/read?at=${encodeURIComponent(PARAGRAPHS[at].cfi)}`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar.getByRole("button", { name: "Play" })).toBeEnabled();
  return bar;
}

/**
 * A closing line the book does not print: the test audio otherwise ends
 * 0.4 s after the last word starts, and a slow machine might let it run to
 * its end (a "pause" and an "ended") before the test stops it.
 */
const TAIL = "And that is where this part of the reading ends.";

/**
 * Waits until the audio reaches `ms`. If it never does, prints what the player was doing first, so a stall on CI
 * can be read from the log alone (run 37348223223 timed out before the test read the player's events).
 * readyState 2 with a "waiting" event: WebKit paused to buffer. readyState 4, not paused, no "waiting": the media
 * pipeline froze while the element thought it was playing.
 */
async function playUntil(page: Page, ms: number) {
  try {
    await page.waitForFunction((t) => document.querySelector("audio")!.currentTime * 1000 >= t, ms, { timeout: 45_000 });
  } catch (e) {
    const player = await page
      .evaluate(() => {
        const a = document.querySelector("audio")!;
        const spans = (r: TimeRanges) => Array.from({ length: r.length }, (_, i) => [r.start(i), r.end(i)]);
        const w = window as unknown as { events_?: [string, number][]; pauses_?: [number, string][]; frames_?: unknown[] };
        return {
          src: a.getAttribute("src"),
          currentTime: a.currentTime,
          paused: a.paused,
          seeking: a.seeking,
          readyState: a.readyState,
          networkState: a.networkState,
          error: a.error ? { code: a.error.code, message: a.error.message } : null,
          buffered: spans(a.buffered),
          events: w.events_ ?? null,
          pauses: w.pauses_ ?? null,
          frames: w.frames_ ? { count: w.frames_.length, first: w.frames_[0], last: w.frames_.at(-1) } : null,
        };
      })
      .catch((err: Error) => `the page did not answer: ${err.message}`);
    console.log(`playUntil: the audio never reached ${ms} ms. The player: ${JSON.stringify(player)}`);
    throw e;
  }
}

/** Every answer the server gave for an import's audio: the range asked for, the status, and the range sent. */
function watchAnswers(page: Page, importId: string) {
  const answers: { asked: string | null; status: number; sent: [number, number, number] | null; length: number }[] = [];
  page.on("response", (r) => {
    if (!r.url().includes(`/readalong/${importId}/audio/`)) return;
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers()["content-range"] ?? "");
    answers.push({ asked: r.request().headers().range ?? null, status: r.status(), sent: m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null, length: Number(r.headers()["content-length"] ?? -1) });
  });
  return answers;
}

/** "bytes=N-": from N to the end of the file. */
const openEnded = (asked: string | null) => !!asked && /^bytes=\d+-$/.test(asked);

/**
 * The audio's answers follow lib/http-range.ts: an open-ended request
 * ("bytes=N-") is answered to the end of the file (the server reads and
 * sends it in pieces); a closed one with at most TEST_MAX_RANGE bytes (8 MB
 * on the live site), and when that cut it short the player asked for the
 * rest; an answer without a range only to a request that asked for none
 * (WebKit on Linux, as CI runs it, plays audio through GStreamer, whose first
 * request asks for no range; Playwright reports that answer with status 0 or
 * 200).
 */
function expectAnswersInPieces(answers: ReturnType<typeof watchAnswers>) {
  expect(answers.length).toBeGreaterThan(0);
  for (const a of answers) {
    if (a.status === 206) {
      expect(a.sent, `answer to ${a.asked}`).not.toBeNull();
      const [from, to, size] = a.sent!;
      if (openEnded(a.asked)) expect(to, `answer to ${a.asked}: to the end of the file`).toBe(size - 1);
      else expect(to - from + 1, `answer to ${a.asked}`).toBeLessThanOrEqual(TEST_MAX_RANGE);
    } else {
      expect(a.asked, `a whole-file answer (status ${a.status}) only when no range was asked for`).toBeNull();
      expect([0, 200], "the answer to a request for the whole file").toContain(a.status);
    }
  }
  // A closed request cut short (Safari's engine on the Mac asks for whole files that way): the player asked for the rest.
  const cut = answers.filter((a) => a.status === 206 && a.asked && !openEnded(a.asked) && a.sent && Number(/-(\d+)$/.exec(a.asked)?.[1] ?? 0) > a.sent[1]);
  if (cut.length) {
    expect(
      cut.some((c) => answers.some((a) => a.sent && a.sent[0] === c.sent![1] + 1)),
      "the player asked for the rest of the audio after an answer that was cut short",
    ).toBe(true);
  }
}

/** The reader's book file was sent whole and intact (in pieces on the server: lib/serve-file.ts). */
async function expectBookIntact(response: Promise<import("@playwright/test").Response>) {
  const r = await response;
  expect(r.status()).toBe(200);
  const body = await r.body();
  expect(body.byteLength).toBe(BOOK.byteLength);
  const { createHash } = await import("node:crypto");
  expect(createHash("sha256").update(body).digest("hex")).toBe(createHash("sha256").update(BOOK).digest("hex"));
}

const names = (events: [string, number][]) => events.map((e) => e[0]);

test("M13 (d): an EPUB plays its audiobook straight on across paragraphs, lighting every word in order, on time", async ({ page }) => {
  test.setTimeout(120_000);
  const bookId = await jekyllId(page);
  // Short lines of dialogue in chapter 2, read after a spoken heading, with
  // a spoken aside the book does not print (a short untimed gap that plays
  // through), and one word the narrator skipped. (Paragraphs whose opening
  // words are not also earlier in the chapter: the matcher anchors a
  // chapter's audio at the first place its first four words agree.)
  // (A closing line the book does not print keeps the audio going after the last word.)
  const { zip, expected } = readAlong([{ title: "Search for Mr. Hyde", said: ["Search for Mr. Hyde.", 61, 62, 63, "He paused.", 64, 65, 66, TAIL], notSpoken: ["hoarsely."] }]);
  const imp = await importReading(page, bookId, zip(), expected);
  expect(expected.map((w) => w.word)).not.toContain("hoarsely.");
  const answers = watchAnswers(page, imp.id);

  // The book itself (270 KB) arrives whole: on the test server every file
  // over 64 KB asked for whole is read and sent in pieces.
  const bookFile = page.waitForResponse((r) => r.url().includes("/api/files/books/"));
  const bar = await openListening(page, bookId, 61);
  await expectBookIntact(bookFile);
  await expect(bar).toContainText("Your audiobook: free to play.");
  await expect(bar.getByLabel("Voice")).toHaveValue(`upload:${imp.id}`);
  await expect(bar.getByLabel("Voice").locator("option:checked")).toHaveText("Your audiobook");
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, expected.at(-1)!.startMs + 400);
  const { frames, events } = await recording(page);
  await page.evaluate(() => document.querySelector("audio")!.pause());

  // Every word, in order, each within a tenth of a second and on the page on screen; all six paragraphs in turn.
  const { paragraphs } = expectEveryWordOnTime(frames, expected, { minWords: expected.length, onScreen: true });
  expect(paragraphs).toEqual([61, 62, 63, 64, 65, 66].map((i) => PARAGRAPHS[i].cfi));
  // The skipped word never lit up.
  expect(frames.filter((f) => f[1].includes("hoarsely") || f[3]?.includes("hoarsely"))).toEqual([]);
  // One audio element, loaded once and never reloaded; no pause, no stall;
  // no seek after the first (to the reading position): the aside played through.
  expect(names(events).filter((n) => n === "loadstart")).toHaveLength(1);
  for (const n of ["emptied", "abort", "error", "pause"]) expect(names(events)).not.toContain(n);
  expect(names(events).filter((n) => n === "seeking").length).toBeLessThanOrEqual(1);
  const started = frames.findIndex((f) => !f[4]);
  expect(frames.slice(started).filter((f) => f[4])).toEqual([]);
  expectNoStall(frames);
  // The audio came in 64 KB answers, and the player kept asking for more.
  expectAnswersInPieces(answers);

  // The bar, with the audiobook chosen and a word lit: accessible, in four looks.
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const { mkdir } = await import("node:fs/promises");
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      const b = await openListening(page, bookId, 61);
      await b.getByRole("button", { name: "Play" }).click();
      // Playing (the file loaded and at its start), then moved on to a word.
      await playUntil(page, expected[0].startMs + 50);
      const word = expected[6];
      await page.evaluate((t) => {
        const a = document.querySelector("audio")!;
        a.pause();
        a.currentTime = t;
      }, (word.startMs + 50) / 1000);
      await expect(b).toHaveAttribute("data-word", word.word);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The bar sits below the page: the book's view ends above it.
      const [view, barBox] = await Promise.all([page.locator("foliate-view").boundingBox(), b.boundingBox()]);
      expect(view!.y + view!.height).toBeLessThanOrEqual(barBox!.y + 1);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-audiobook-${name}-${scheme}${engine()}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
});

// On a phone with the largest text, a few short paragraphs fill more than
// one page: the page must turn as the reading goes on, so that every word
// lights up where the reader can see it.
test("M13 (d): on a phone with large text, the page turns as the reading goes on and every lit word is on screen", async ({ page }) => {
  test.setTimeout(120_000);
  const bookId = await jekyllId(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("neolibrary.reader.v1", JSON.stringify({ size: 170 })));
  const { zip, expected } = readAlong([{ title: "Search for Mr. Hyde", said: [61, 62, 63, 64, 65, 66, 67, 68, TAIL] }]);
  await importReading(page, bookId, zip(), expected);
  const bar = await openListening(page, bookId, 61);
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, expected.at(-1)!.startMs + 300);
  const { frames } = await recording(page);
  await page.evaluate(() => document.querySelector("audio")!.pause());
  expectEveryWordOnTime(frames, expected, { minWords: expected.length, onScreen: true });
  expectNoStall(frames);
  // The page did turn while the audio played.
  const playingAt = new Set(frames.filter((f) => !f[4]).map((f) => f[6]));
  expect(playingAt.size, "pages shown while playing").toBeGreaterThanOrEqual(2);
});

// The book's chapter 1 ends and chapter 2 begins, with the new chapter's
// heading spoken between them, as in real audiobooks. A new chapter takes a
// moment to open, so the page turns as soon as the last word of chapter 1
// is over: by the time chapter 2's first word is spoken, it is on the page.
test("M13 (d): reading on into the book's next chapter, the page turns during the spoken heading and every word lights on time", async ({ page }) => {
  test.setTimeout(90_000);
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([{ title: "Two chapters", said: [32, "Search for Mr. Hyde.", 33] }]);
  await importReading(page, bookId, zip(), expected);
  const bar = await openListening(page, bookId, 32);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/6!/);
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  const first = expected.findIndex((w) => w.cfi === PARAGRAPHS[33].cfi);
  await playUntil(page, expected[first + 8].startMs + 300);
  const { frames, events } = await recording(page);
  await page.evaluate(() => document.querySelector("audio")!.pause());
  const { paragraphs } = expectEveryWordOnTime(frames, expected, { minWords: first + 8, onScreen: true });
  expect(paragraphs).toEqual([32, 33].map((i) => PARAGRAPHS[i].cfi));
  // The page turned to chapter 2 (spine item /6/8) during the heading: after
  // chapter 1's last word, before chapter 2's first.
  const turned = frames.find((f) => f[6].startsWith("epubcfi(/6/8!"));
  expect(turned, "the reader turned to chapter 2").toBeDefined();
  expect(turned![0] * 1000).toBeGreaterThan(expected[first - 1].startMs);
  expect(turned![0] * 1000, "turned before chapter 2's first word").toBeLessThan(expected[first].startMs);
  // And the audio was never reloaded, nor stalled.
  expect(names(events).filter((n) => n === "loadstart")).toHaveLength(1);
  expect(names(events)).not.toContain("pause");
  expectNoStall(frames);
});

// The shape of real packages (Kuhn: one file per chapter): a new audio file
// that is also a new chapter of the book. Here the first file ends with
// several seconds the book does not print, so the player moves to the next
// file by itself before this one ends (it does not wait for "ended"), and
// starts that file at its beginning, so its chapter title is heard.
const OUTRO =
  "This is the end of chapter one of this test reading. The voice goes on for a while here, saying things that are not printed in the book, so that the player has to move on to the next file by itself, before this one ends.";

test("M13 (d): into a new chapter's audio file: the player moves on before the old file ends, turns the page in time, and plays the chapter title", async ({ page }) => {
  test.setTimeout(90_000);
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([
    { title: "One", said: [32, OUTRO] },
    { title: "Two", said: ["Chapter Two. Search for Mr. Hyde.", 33] },
  ]);
  await importReading(page, bookId, zip(), expected);
  const bar = await openListening(page, bookId, 32);
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  const first = expected.findIndex((w) => w.cfi === PARAGRAPHS[33].cfi);
  await page.waitForFunction(() => /\/audio\/1$/.test(document.querySelector("audio")!.getAttribute("src") ?? ""), undefined, { timeout: 30_000 });
  await playUntil(page, expected[first + 8].startMs + 300);
  const { frames, events } = await recording(page);
  await page.evaluate(() => document.querySelector("audio")!.pause());
  expectEveryWordOnTime(frames, expected, { minWords: first + 8, onScreen: true });
  // The first file did not run to its end: the player moved on by itself.
  expect(names(events)).not.toContain("ended");
  expect(names(events).filter((n) => n === "loadstart")).toHaveLength(2);
  expect(names(events)).not.toContain("error");
  // The new file started at its beginning (its chapter title), not at its first paragraph.
  const inSecond = frames.filter((f) => f[5] === 1);
  expect(inSecond[0][0]).toBeLessThan(0.3);
  expect(expected[first].startMs).toBeGreaterThan(800);
  // The page showed chapter 2 before its first word.
  const turned = frames.find((f) => f[6].startsWith("epubcfi(/6/8!"));
  expect(turned, "the reader turned to chapter 2").toBeDefined();
  expect(turned![5] === 0 || turned![0] * 1000 < expected[first].startMs, "turned before chapter 2's first word").toBe(true);
  expectNoStall(frames);
});

// Kuhn has one file per chapter. Crossing from one to the next at its end
// sets the audio element's source once more and plays on from the "ended"
// event, which Safari's engine might refuse without a click.
test("M13 (d): the audiobook plays on from one chapter's audio file into the next, and says when it ends", async ({ page }) => {
  test.setTimeout(90_000);
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([
    { title: "One", said: ["Chapter One.", 63, 64] },
    { title: "Two", said: ["Chapter Two.", 65, 66] },
  ]);
  const imp = await importReading(page, bookId, zip(), expected);
  expect(imp.info.audiobook.files).toHaveLength(2);
  const bar = await openListening(page, bookId, 63);
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  // To the end: the bar says so and stops.
  await expect(bar).toContainText("That is the end of your audiobook.", { timeout: 30_000 });
  await expect(bar.getByRole("button", { name: "Play" })).toBeVisible();
  const { frames, events } = await recording(page);
  const { paragraphs } = expectEveryWordOnTime(frames, expected, { minWords: expected.length, onScreen: true });
  expect(paragraphs).toEqual([63, 64, 65, 66].map((i) => PARAGRAPHS[i].cfi));
  // The second file was loaded once, by the same element: exactly one more start.
  expect(names(events).filter((n) => n === "loadstart")).toHaveLength(2);
  expect(names(events)).not.toContain("error");
  expect(new Set(frames.map((f) => f[5]).filter((f) => f >= 0))).toEqual(new Set([0, 1]));
});

// A long audiobook (a WAV of about 16 MB), started well into the file:
// the browser asks for the bytes it needs there and plays on as each
// answer runs out. (Safari's engine asks for the whole file as one closed
// range, "bytes=0-<last>"; Chromium asks "bytes=0-".)
test("M13 (d): a long audiobook plays from far into its file, its audio arriving in capped pieces", async ({ page }) => {
  test.setTimeout(120_000);
  const bookId = await jekyllId(page);
  const { zip, expected, files } = readAlong([{ title: "Long", said: PARAGRAPHS.slice(40, 140).map((_, k) => 40 + k) }], "Long reading");
  expect(files["audio/01.wav"].byteLength).toBeGreaterThan(15 * 1024 * 1024);
  const imp = await importReading(page, bookId, zip(), expected);
  const answers = watchAnswers(page, imp.id);
  // The player starts at the first timed paragraph from the top of the page
  // that holds paragraph 112 (about 700 s in).
  const opened = page.waitForResponse((r) => /\/audio\?cfi=/.test(r.url()));
  const bar = await openListening(page, bookId, 112);
  const start = (await (await opened).json()).audiobook.paragraphs[0].cfi as string;
  const from = expected.slice(expected.findIndex((w) => w.cfi === start));
  // That is more than 8 MB into the file (16,000 bytes a second).
  expect(from[0].startMs * 16).toBeGreaterThan(8 * 1024 * 1024 * 1.1);
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  const second = from.findIndex((w) => w.cfi !== from[0].cfi);
  await playUntil(page, from[second + 3].startMs + 300);
  const { frames } = await recording(page);
  console.log(`[${test.info().project.name}] audio requests: ${answers.map((a) => `${a.asked ?? "no range"} → ${a.status}`).join("; ")}`);
  // WebKit on Linux (CI) asks only open-ended ranges, or none: after the seek far into the file, no request may go
  // back for the bytes it skipped. GStreamer's on-disk mode does, and stalled on it (playwright.config.ts,
  // noMediaDiskCache). Safari's engine on a Mac asks closed ranges, so this is not checked there.
  if (engine() === "-safari" && answers.every((a) => a.asked === null || openEnded(a.asked))) {
    const starts = answers.map((a) => (openEnded(a.asked) ? Number(/\d+/.exec(a.asked!)![0]) : -1));
    const seek = starts.findIndex((s) => s >= 8 * 1024 * 1024);
    expect(seek, "a request far into the file").toBeGreaterThanOrEqual(0);
    expect(starts.slice(seek + 1).filter((s) => s >= 0 && s < starts[seek]), "a request went back for skipped bytes").toEqual([]);
  }
  await page.evaluate(() => document.querySelector("audio")!.pause());
  expectEveryWordOnTime(frames, from, { minWords: second + 3, onScreen: true });
  expectNoStall(frames);
  expectAnswersInPieces(answers);
  // The bytes it played came from far into the file, by range (unless the
  // engine read the whole file without asking for ranges: WebKit on Linux).
  if (answers.every((a) => a.status === 206)) expect(answers.some((a) => a.sent![0] >= 8 * 1024 * 1024)).toBe(true);
});

// The audiobook's address has no expiry to run out: it is checked by the
// sign-in cookie. (A signed /api/files link expires after 5 minutes, and an
// audio element keeps asking for ranges for as long as it plays.)
test("M13 (d): the audiobook's audio is served by sign-in alone, with no link to expire, and never to a signed-out visitor", async ({ page, browser }) => {
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([{ title: "Short", said: [63, 64] }]);
  const imp = await importReading(page, bookId, zip(), expected);
  const url = imp.info.audiobook.files[0].url as string;
  expect(url).toBe(`/api/books/${bookId}/readalong/${imp.id}/audio/0`);
  expect(url).not.toMatch(/exp=|sig=/);
  const part = await page.request.get(url, { headers: { range: "bytes=0-3" } });
  expect(part.status()).toBe(206);
  expect((await part.body()).toString()).toBe("RIFF");
  expect(part.headers()["content-type"]).toBe("audio/wav");
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.get(new URL(url, page.url()).href, { headers: { range: "bytes=0-3" } })).status()).toBe(401);
  // The next part of the paragraphs, likewise.
  const partsUrl = new URL(`${imp.info.audiobook.partsUrl}?from=0`, page.url()).href;
  expect((await anon.request.get(partsUrl)).status()).toBe(401);
  expect(await (await page.request.get(partsUrl)).json()).toMatchObject({ paragraphs: [{ cfi: PARAGRAPHS[63].cfi }, { cfi: PARAGRAPHS[64].cfi }], more: null });
  await anon.close();
  expect((await page.request.get(url.replace(/\/0$/, "/1"))).status()).toBe(404);
  expect((await page.request.get(url.replace(imp.id, crypto.randomUUID()))).status()).toBe(404);
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
  // Removed: its audio is gone too.
  expect((await page.request.get(url)).status()).toBe(404);
});

test("M13 (d): Pause and Play go on where the audio stopped, without reloading it, and bring back a page turned away from", async ({ page }) => {
  test.setTimeout(90_000);
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([{ title: "Search for Mr. Hyde", said: [61, 62, 63, 64, 65, 66] }]);
  await importReading(page, bookId, zip(), expected);
  const bar = await openListening(page, bookId, 61);
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, expected[6].startMs + 50);
  await bar.getByRole("button", { name: "Pause" }).click();
  const stoppedAt = await page.evaluate(() => document.querySelector("audio")!.currentTime);
  // The reader looks at another chapter meanwhile.
  const here = await page.getByTestId("reader").getAttribute("data-cfi");
  await page.evaluate(() => (document.querySelector("foliate-view") as unknown as { goTo(t: string): Promise<void> }).goTo("epubcfi(/6/12!/4/2)"));
  await expect(page.getByTestId("reader")).not.toHaveAttribute("data-cfi", here ?? "");
  await bar.getByRole("button", { name: "Play" }).click();
  // Back to the paragraph being read, going on from where it stopped.
  await expect(page.getByTestId("reader")).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/8!/);
  await playUntil(page, expected[12].startMs + 50);
  const { frames, events } = await recording(page);
  expect(names(events).filter((n) => n === "loadstart")).toHaveLength(1);
  // Playing again after the pause (not the first Play) went on from where it stopped.
  const paused = frames.findIndex((f, k) => k > 0 && f[4] && !frames[k - 1][4]);
  const resumed = frames.slice(paused).find((f) => !f[4]);
  expect(paused).toBeGreaterThan(0);
  expect(resumed![0]).toBeGreaterThanOrEqual(stoppedAt - 0.05);
  // The words after the pause light up on the page on screen.
  const after = frames.filter((f) => f[0] * 1000 >= expected[10].startMs);
  expect(after.some((f) => f[3] === expected[11].word && f[8] === true)).toBe(true);
});

// A paragraph longer than a page: going on after a pause stays on the page
// of the word being read (turning back to the paragraph's first page would
// only turn forward again a moment later).
test("M13 (d): in a paragraph longer than a page, Pause and Play stay on the page of the word being read", async ({ page }) => {
  test.setTimeout(90_000);
  const bookId = await jekyllId(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("neolibrary.reader.v1", JSON.stringify({ size: 170 })));
  const { zip, expected } = readAlong([{ title: "Search for Mr. Hyde", said: [69] }]);
  await importReading(page, bookId, zip(), expected);
  const bar = await openListening(page, bookId, 69);
  const first = await page.getByTestId("reader").getAttribute("data-cfi");
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, expected[0].startMs + 50);
  // Well into the paragraph, several pages on: the pages turn to the word.
  const far = expected[Math.floor(expected.length * 0.6)];
  await page.evaluate((t) => {
    document.querySelector("audio")!.currentTime = t;
  }, far.startMs / 1000);
  await expect
    .poll(
      async () => {
        const f = (await recording(page)).frames.at(-1);
        return !!f && f[0] * 1000 >= far.startMs && f[8] === true;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  await bar.getByRole("button", { name: "Pause" }).click();
  const there = await page.getByTestId("reader").getAttribute("data-cfi");
  expect(there).not.toBe(first);
  const before = (await recording(page)).frames.length;
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, far.startMs + 1500);
  const after = (await recording(page)).frames.slice(before);
  expect(after.length).toBeGreaterThan(10);
  // Never back to the paragraph's first page, and the lit word on screen as soon as it goes on.
  expect(after.filter((f) => f[6] === first)).toEqual([]);
  const lit = after.filter((f) => !f[4] && f[3]);
  expect(lit.length).toBeGreaterThan(0);
  expect(lit.slice(0, 3).every((f) => f[8] === true)).toBe(true);
});

test("M13 (d): switching voices hands the place over: a made voice reads on from the audiobook's paragraph, and back", async ({ page }) => {
  test.setTimeout(90_000);
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([{ title: "Search for Mr. Hyde", said: [61, 62, 63, 64, 65, 66] }]);
  const imp = await importReading(page, bookId, zip(), expected);
  const bar = await openListening(page, bookId, 61);
  await bar.getByRole("button", { name: "Play" }).click();
  // Into paragraph 63, then a made voice.
  await playUntil(page, expected.find((w) => w.cfi === PARAGRAPHS[63].cfi)!.startMs + 100);
  await expect(bar).toHaveAttribute("data-passage", PARAGRAPHS[63].cfi);
  await bar.getByRole("button", { name: "Pause" }).click();
  // The bar asks for paragraph 63 in the made voice (its cost, or audio saved earlier: the
  // Chromium run before this one may have made it).
  const handedOver = page.waitForResponse((r) => r.url().includes("/audio?") && new URL(r.url()).searchParams.get("section") === PARAGRAPHS[63].id);
  await bar.getByLabel("Voice").selectOption("fake-ada");
  expect((await (await handedOver).json()).passage.id).toBe(PARAGRAPHS[63].id);
  await expect(bar).toContainText(/This paragraph costs (about \$|under \$)[\d.]+ to read aloud; then it is saved\.|Saved audio: free to play\./);
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar).toHaveAttribute("data-passage", PARAGRAPHS[63].cfi);
  await bar.getByRole("button", { name: "Pause" }).click();
  // And back: the audiobook goes on from the made voice's paragraph (once
  // its file has loaded), lighting nothing before it.
  await bar.getByLabel("Voice").selectOption(`upload:${imp.id}`);
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar).toHaveAttribute("data-passage", PARAGRAPHS[63].cfi);
  const p63 = expected.filter((w) => w.cfi === PARAGRAPHS[63].cfi);
  await playUntil(page, p63[2].startMs + 50);
  const { frames } = await recording(page);
  // Only paragraph 63 was shown (none before it), and its first words lit up.
  expect(new Set(frames.map((f) => f[2]).filter(Boolean))).toEqual(new Set([PARAGRAPHS[63].cfi]));
  const words = frames.map((f) => f[1]).filter((w, k, all) => w && w !== all[k - 1]);
  expect(words).toContain(p63[0].word);
  expect(words).toContain(p63[1].word);
});

test("M13 (d): an audiobook that begins in a later chapter is not started unasked, and one that ends earlier says so", async ({ page }) => {
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([{ title: "Search for Mr. Hyde", said: [61, 62, 63] }]);
  const imp = await importReading(page, bookId, zip(), expected);
  // Opened in chapter 1: a made voice is chosen, and the audiobook says where it begins.
  let bar = await openListening(page, bookId, 20);
  await expect(bar.getByLabel("Voice")).toHaveValue("fake-ada");
  await bar.getByLabel("Voice").selectOption(`upload:${imp.id}`);
  await expect(bar).toContainText("Your audiobook begins further on (Search for Mr. Hyde): Play turns to it.");
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/8!/);
  await expect(bar).toHaveAttribute("data-passage", PARAGRAPHS[61].cfi);
  await bar.getByRole("button", { name: "Pause" }).click();
  // Opened after its last paragraph: it says so, and cannot play.
  bar = await openListening(page, bookId, 70);
  await bar.getByLabel("Voice").selectOption(`upload:${imp.id}`);
  await expect(bar).toContainText("Your audiobook ends before this part of the book.");
  await expect(bar.getByRole("button", { name: "Play" })).toBeDisabled();
});

test("M13 (d): offline, the bar says reading aloud needs the internet; a removed audiobook says it could not be played", async ({ page, context }) => {
  test.setTimeout(90_000);
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([{ title: "Search for Mr. Hyde", said: [61, 62, 63] }]);
  const imp = await importReading(page, bookId, zip(), expected);
  await page.goto(`/books/${bookId}/read?at=${encodeURIComponent(PARAGRAPHS[61].cfi)}`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  // Offline when Listen is pressed.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar).toContainText("Reading aloud needs an internet connection");
  await bar.getByRole("button", { name: "Stop reading aloud" }).click();
  // Online when it opens, offline when Play is pressed.
  await context.setOffline(false);
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(bar.getByRole("button", { name: "Play" })).toBeEnabled();
  await context.setOffline(true);
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar).toContainText("Reading aloud needs an internet connection", { timeout: 15_000 });
  await context.setOffline(false);
  await bar.getByRole("button", { name: "Stop reading aloud" }).click();
  // The audiobook removed while the bar is open (from another tab, say).
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(bar.getByRole("button", { name: "Play" })).toBeEnabled();
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar).toContainText("Your audiobook could not be played. Reload the page and try again.", { timeout: 15_000 });
});

// M13 (e): read along in a PDF. Two pages drawn here (no copyrighted text),
// laid out as Samuel's Kuhn is: on each page a running head drawn first, at
// the top, then the body, then the page number, drawn last. Page 1 has a
// word broken across lines ("normal-" / "scientific") and ends in the middle
// of a sentence that goes on at the top of page 2. Page 2 ends with two
// footnotes in smaller type (one word in italics): with them the page has
// more than ten pieces of text, and pdf.js sends a page's text ten pieces at
// a time, so this page's text comes in two (checked: 10 + 10). The narrator reads the broken
// word whole and straight on across the page break (no pause there), does
// not read the running heads, page numbers or footnotes, and pauses after
// each paragraph.
async function readAlongPdf() {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  // (The shelf knows a book by its title: a new layout of this file needs a new title.)
  doc.setTitle("Read-Along Test Pages");
  doc.setAuthor("Neolibrary tests");
  // Fixed dates (pdf-lib stamps the time otherwise), so every run makes the same file: a
  // second run finds the book already on the shelf, and the package must match that file.
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  // Three lines or more to a paragraph, so that a page's usual line step (the median, which the paragraph split uses) is the step within one.
  const pages = [
    {
      head: "Introduction",
      paragraphs: [
        ["A careful reader learns to trust the slow and normal-", "scientific habit of looking twice at a page, and", "then once more before turning it."],
        ["Then a second paragraph begins, and it runs on", "to the foot of the page and over the break", "without a pause, as a sentence does in"],
      ],
    },
    {
      head: "Pages Read Aloud",
      paragraphs: [
        ["most real books, and then it comes to", "an end of its own, a little way down", "the next page."],
        ["The next part opens with a short line of", "plain words for the voice to read, and then", "a third line to make the page look usual."],
        ["And a last paragraph closes the test, in", "three short lines, each of them", "read aloud like the rest."],
      ],
      notes: [
        ["1. A first note in smaller type, which the narrator"],
        ["does not read, as notes are often left out of an"],
        ["audiobook; the next one has a word in ", "italics", "."],
        ["2. A second note, also left unread."],
      ],
    },
  ];
  pages.forEach(({ head, paragraphs, notes }, n) => {
    const page = doc.addPage([612, 792]);
    page.drawText(head, { x: 72, y: 750, size: 9, font });
    let y = 700;
    for (const lines of paragraphs) {
      for (const line of lines) {
        page.drawText(line, { x: 72, y, size: 12, font });
        y -= 15;
      }
      y -= 20;
    }
    for (const parts of notes ?? []) {
      let x = 72;
      parts.forEach((part, k) => {
        const f = k === 1 ? italic : font;
        page.drawText(part, { x, y, size: 9, font: f });
        x += f.widthOfTextAtSize(part, 9);
      });
      y -= 11;
    }
    page.drawText(String(n + 1), { x: 300, y: 40, size: 9, font });
  });
  const bytes = new Uint8Array(await doc.save({ useObjectStreams: false }));
  /** Where a word of a line on page 2 is printed (points from the page's left edge): from the font's own widths. */
  const printedAt = (before: string, word: string) => ({ left: 72 + font.widthOfTextAtSize(before, 12), width: font.widthOfTextAtSize(word, 12) });
  const ps = (await extractPdfSections(bytes)).filter((x) => x.kind === "paragraph");
  // What the narrator reads: not the running heads, page numbers or footnotes.
  const body = ps.filter((p) => !["Introduction", "Pages Read Aloud", "1", "2"].includes(p.text) && !p.text.startsWith("1. "));
  const said = [body[0].text.replace("normal- scientific", "normal-scientific"), ...body.slice(1).map((p) => p.text), TAIL];
  const pkg = buildPackage({
    bookBytes: bytes,
    title: "Pages read aloud",
    chapters: [{ title: "One", paragraphs: said, inBook: [...body.map((p) => p.chapterIndex), null], pauses: [0.8, 0, 0.8, 0.8, 0.8] }],
  });
  return { bytes, ps, body, pkg, printedAt };
}

/** Uploads the PDF and its package; returns the book, the import, and every word the server placed, with its time. */
async function uploadPdfReading(page: Page, bytes: Uint8Array, pkg: ReturnType<typeof buildPackage>, ps: Section[]) {
  const upload = await page.request.post("/api/books", { multipart: { files: { name: "pages-read-aloud.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) } } });
  const added = (await upload.json()).results[0];
  expect(["added", "duplicate"]).toContain(added.status);
  const bookId = added.bookId as string;
  const res = await page.request.post(`/api/books/${bookId}/readalong`, { data: Buffer.from(pkg.zip()), headers: { "content-type": "application/zip" } });
  const body = await res.json();
  expect(body.error ?? null).toBeNull();
  expect(body.import.status).toBe("ready");
  // The words as the page shows them (no space where a line breaks), with their times, from the server.
  const info = await (await page.request.get(`/api/books/${bookId}/audio?${new URLSearchParams({ cfi: "epubcfi(/6/2)" })}`)).json();
  expect(info.fileType).toBe("pdf");
  expect(info.voices).toEqual([{ id: `upload:${body.import.id}`, name: "Your audiobook" }]);
  const expected: Spoken[] = (info.audiobook.paragraphs as { sectionId: string; cfi: string; file: number; words: [number, number, number, number][] }[]).flatMap((p) =>
    p.words.map(([startMs, , from, to]) => ({ word: ps.find((x) => x.id === p.sectionId)!.text.slice(from, to).replace(/\s+/g, ""), startMs, file: p.file, cfi: p.cfi })),
  );
  return { bookId, importId: body.import.id as string, expected };
}

/** The text lit in the book's page now, if any. */
const litNow = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document | null }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const h = (doc?.defaultView as unknown as { CSS: { highlights?: Map<string, Set<Range>> } } | null)?.CSS.highlights?.get("nl-spoken");
      if (h) return [...h].map((r) => r.toString()).join(" ");
    }
    return null;
  });

/** The lit word's box on the page, in points from the page picture's top left corner (`width` points wide). */
const litBox = (page: Page, width: number) =>
  page.evaluate((pageWidth) => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document | null }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const h = (doc?.defaultView as unknown as { CSS: { highlights?: Map<string, Set<Range>> } } | null)?.CSS.highlights?.get("nl-spoken");
      const canvas = doc?.querySelector("#canvas canvas");
      if (!h || !canvas) continue;
      const c = canvas.getBoundingClientRect();
      const r = [...h][0].getBoundingClientRect();
      const scale = c.width / pageWidth; // CSS pixels per point
      return { left: (r.left - c.left) / scale, top: (r.top - c.top) / scale, width: r.width / scale, height: r.height / scale };
    }
    return null;
  }, width);

/**
 * Whether the lit word can be seen: the share of its box on screen showing
 * the highlight's tint (the text layer's letters are see-through, so only
 * the tint shows), and the same for a box of its size just after it on the
 * line. A PDF page is white in every theme, and the tint is the same.
 */
async function tintSeen(page: Page) {
  const box = await page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document | null }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const win = doc?.defaultView as unknown as (Window & { CSS: { highlights?: Map<string, Set<Range>> } }) | null;
      const h = win?.CSS.highlights?.get("nl-spoken");
      if (!h || !win?.frameElement) continue;
      const r = [...h][0].getBoundingClientRect();
      const f = win.frameElement.getBoundingClientRect();
      return { x: f.left + r.left, y: f.top + r.top, width: r.width, height: r.height };
    }
    return null;
  });
  expect(box, "a word is lit").not.toBeNull();
  // Inside the box (a pixel in from each edge), and the same size just after it.
  const clip = (dx: number) => ({ x: Math.ceil(box!.x + dx) + 1, y: Math.ceil(box!.y) + 1, width: Math.floor(box!.width) - 2, height: Math.floor(box!.height) - 2 });
  const share = async (dx: number) =>
    page.evaluate(async (b64) => {
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      // rgb(156 196 182 / 0.5) over white paper: about (206, 226, 219).
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 206) < 12 && Math.abs(d[i + 1] - 226) < 12 && Math.abs(d[i + 2] - 219) < 12) n++;
      return n / (d.length / 4);
    }, (await page.screenshot({ clip: clip(dx) })).toString("base64"));
  return { lit: await share(0), after: await share(box!.width + 2) };
}

/** Counts the page's text layer redraws from now on (window.redraws_). */
const countRedraws = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { redraws_: number };
    w.redraws_ = 0;
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document | null }[] } };
    for (const { doc } of view.renderer.getContents()) doc?.addEventListener("nl-textlayer", () => w.redraws_++);
  });
const redraws = (page: Page) => page.evaluate(() => (window as unknown as { redraws_: number }).redraws_);

test("M13 (e): a PDF plays its audiobook across paragraphs and on across a page break, each word lit in the page's text, on time", async ({ page }) => {
  test.setTimeout(120_000);
  const { bytes, ps, body, pkg, printedAt } = await readAlongPdf();
  // The running heads, page numbers and footnotes are paragraphs of their own, never read aloud.
  expect(ps.map((p) => p.text)).toEqual([
    "Introduction",
    body[0].text,
    body[1].text,
    "1",
    "Pages Read Aloud",
    body[2].text,
    body[3].text,
    body[4].text,
    "1. A first note in smaller type, which the narrator does not read, as notes are often left out of an audiobook; the next one has a word in italics. 2. A second note, also left unread.",
    "2",
  ]);
  const { bookId, importId, expected } = await uploadPdfReading(page, bytes, pkg, ps);
  // Every word the narrator read is there, with the package's own time: the broken word as one.
  const timings = JSON.parse(Buffer.from(pkg.files["timings/01.json"]).toString()).words as { w: string; start: number; end: number }[];
  const tail = TAIL.split(" ").length;
  expect(expected.map((w) => [w.word, w.startMs])).toEqual(timings.slice(0, -tail).map((w) => [w.w, Math.round(w.start * 1000)]));
  expect(expected.map((w) => w.word)).toContain("normal-scientific");
  expect(new Set(expected.map((w) => w.cfi))).toEqual(new Set(["epubcfi(/6/2)", "epubcfi(/6/4)"]));
  // Page 1's last word runs straight into page 2's first: no pause in the reading there.
  const first2 = expected.findIndex((w) => w.cfi === "epubcfi(/6/4)");
  const last1 = timings[first2 - 1];
  expect([last1.w, expected[first2].word]).toEqual(["in", "most"]);
  expect(expected[first2].startMs - last1.end * 1000).toBeLessThan(50);
  // On the shelf this PDF says Read and listen through its uploaded audiobook alone (narration is EPUB only).
  await page.goto("/library");
  const onShelf = page.getByTestId("shelf").getByRole("listitem").filter({ hasText: "Read-Along Test Pages" });
  await expect(onShelf.getByText("Read and listen", { exact: true })).toBeVisible();
  // The Audiobooks filter lists it (an uploaded audiobook), and no book that only has narration.
  await page.goto("/library?show=audiobooks");
  const withAudio = await page.getByTestId("shelf").locator(":scope > li [class*=itemTitle]").allTextContents();
  expect(withAudio).toContain("Read-Along Test Pages");
  expect(withAudio).not.toContain("Frankenstein");

  // The app's timing marks and the fonts pdf.js loads are recorded from the page's first moment.
  await instrument(page);
  await page.goto(`/books/${bookId}/read?at=${encodeURIComponent("epubcfi(/6/2)")}`);
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(reader).toHaveAttribute("data-cfi", "epubcfi(/6/2)");
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar).toContainText("Your audiobook: free to play.");
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, expected.at(-1)!.startMs + 300);
  const rec = await recording(page);
  const { frames, events } = rec;
  await page.evaluate(() => document.querySelector("audio")!.pause());

  // The timings first, printed and attached to the report, so that a run that fails a check
  // below still shows them (this line used to print only when every check had passed).
  const turned = frames.find((f) => f[6] === "epubcfi(/6/4)");
  const litFirst = frames.find((f) => f[3] === expected[first2].word && f[6] === "epubcfi(/6/4)");
  console.log(
    turned && litFirst
      ? `page 2 shown ${Math.round(turned[0] * 1000 - last1.end * 1000)} ms after page 1's last word ended; its first word lit ${Math.round(litFirst[0] * 1000 - expected[first2].startMs)} ms after it began`
      : "page 2 was not shown, or its first word was not lit",
  );
  await reportTiming(rec, expected, { label: "pdf-page-break", focus: first2 });

  // No font is loaded at the page turn: page 2 was drawn ahead while page 1 was read
  // (pdf-book.ts, warmUp). Without that, pdf.js loads page 2's italic font here, on first use,
  // and on CI's Linux WebKit the failed lookup held the page 18-55 ms. Pages count from 0.
  const turnAt = rec.marks.find((m) => m.name === "nl:turn-request" && m.detail?.page === 1)?.t;
  const litAt = rec.marks.find((m) => m.name === "nl:lit" && m.detail?.page === 1)?.t;
  expect(turnAt !== undefined && litAt !== undefined, "page 2's turn and first word were marked").toBe(true);
  expect(
    rec.fonts.filter((f) => f.t0 >= turnAt! && f.t0 <= litAt!),
    "a font was loaded at the page turn",
  ).toEqual([]);

  // Every word, in order, each within a tenth of a second, lit in the page's own text layer and on screen:
  // page 2's first word too, though it follows page 1's last with no pause.
  const { paragraphs } = expectEveryWordOnTime(frames, expected, { minWords: expected.length, onScreen: true });
  expect(paragraphs).toEqual(["epubcfi(/6/2)", "epubcfi(/6/4)"]);
  // The page turned only once page 1's last word had been said.
  expect(turned, "the reader turned to page 2").toBeDefined();
  expect(turned![0] * 1000, "turned after page 1's last word").toBeGreaterThanOrEqual(last1.end * 1000);
  // One audio element, loaded once and never reloaded; no pause, no stall, no seek after the first.
  expect(names(events).filter((n) => n === "loadstart")).toHaveLength(1);
  for (const n of ["emptied", "abort", "error", "pause"]) expect(names(events)).not.toContain(n);
  expect(names(events).filter((n) => n === "seeking").length).toBeLessThanOrEqual(1);
  const started = frames.findIndex((f) => !f[4]);
  expect(frames.slice(started).filter((f) => f[4])).toEqual([]);
  expectNoStall(frames);

  // A new size redraws the page: the word being read stays lit over its printed letters
  // (measured against the font's own widths, in points).
  const word = expected[expected.findIndex((w) => w.word === "opens")];
  const printed = printedAt("The next part ", "opens");
  await page.evaluate((t) => {
    document.querySelector("audio")!.currentTime = t;
  }, (word.startMs + 50) / 1000);
  await expect(bar).toHaveAttribute("data-word", word.word);
  const lies = async () => {
    // Polled: after a resize the picture is drawn again before it and the text change size together.
    const close = (b: Awaited<ReturnType<typeof litBox>>) => !!b && Math.abs(b.left - printed.left) < 4 && Math.abs(b.width - printed.width) < 4;
    await expect.poll(async () => close(await litBox(page, 612)), { timeout: 5000 }).toBe(true).catch(() => undefined);
    const box = (await litBox(page, 612))!;
    expect(Math.abs(box.left - printed.left), `"opens" lit ${box.left.toFixed(1)} pt from the left, printed at ${printed.left.toFixed(1)}`).toBeLessThan(4);
    expect(Math.abs(box.width - printed.width), `"opens" lit ${box.width.toFixed(1)} pt wide, printed ${printed.width.toFixed(1)}`).toBeLessThan(4);
  };
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const { mkdir } = await import("node:fs/promises");
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      const resize = page.viewportSize()?.width !== w;
      await countRedraws(page);
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      // A new width redraws the page: wait for it, so the check is on the new drawing.
      if (resize) await expect.poll(() => redraws(page), { timeout: 10_000 }).toBeGreaterThan(0);
      await expect.poll(() => litNow(page), { timeout: 5000 }).toBe(word.word);
      await lies();
      // And it can be seen: tinted on screen, the next word on its line not.
      const seen = await tintSeen(page);
      expect(seen.lit, `share of "opens" tinted: ${seen.lit.toFixed(2)}`).toBeGreaterThan(0.25);
      expect(seen.after, `share of the box after it tinted: ${seen.after.toFixed(2)}`).toBeLessThan(0.05);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("foliate-view").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-pdf-audiobook-${name}-${scheme}${engine()}.png` });
    }
  }
  // Sizes changed one after another, without waiting (a window dragged, a phone turned). The
  // page's text is laid out again for each size, never thrown away and built again: two
  // rebuilds under way at once (pdf.js adds a page's text in pieces) could leave pieces of
  // both, and the word being read would be lit on the wrong text. So the text is the same
  // text as before (marked here), there once, with the word being read lit over its letters.
  const layer = () =>
    page.evaluate(() => {
      const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document | null }[] } };
      const l = view.renderer.getContents()[0].doc!.querySelector(".textLayer")!;
      return { marked: l.querySelector("span[data-marked]") !== null, text: l.textContent!.replace(/\s+/g, "") };
    });
  await page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document | null }[] } };
    view.renderer.getContents()[0].doc!.querySelector(".textLayer span")!.setAttribute("data-marked", "");
  });
  await countRedraws(page);
  for (const [w, h] of [[700, 700], [1000, 760], [1280, 800]]) await page.setViewportSize({ width: w, height: h });
  await expect.poll(() => redraws(page), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const after = await layer();
  expect(after.marked, "the same text, laid out again").toBe(true);
  expect(after.text).toBe(ps.filter((p) => p.chapterIndex === 1).map((p) => p.text.replace(/\s+/g, "")).join(""));
  await expect.poll(() => litNow(page), { timeout: 5000 }).toBe(word.word);
  await lies();
  await page.emulateMedia({ colorScheme: "light" });
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${importId}`)).status()).toBe(204);
});

test("M13 (e): in a PDF, a page turned back from while it is read comes back; Pause, turning away and Play go on on the word's page", async ({ page }) => {
  test.setTimeout(90_000);
  const { bytes, ps, pkg } = await readAlongPdf();
  const { bookId, importId, expected } = await uploadPdfReading(page, bytes, pkg, ps);
  await page.goto(`/books/${bookId}/read?at=${encodeURIComponent("epubcfi(/6/4)")}`);
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar.getByRole("button", { name: "Play" })).toBeEnabled();
  const page2 = expected.filter((w) => w.cfi === "epubcfi(/6/4)");
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, page2[0].startMs + 50);
  const prev = () => page.evaluate(() => (document.querySelector("foliate-view") as unknown as { prev(): Promise<void> }).prev());

  // Playing, the reader turns back to page 1: the next word brings page 2 back, lit on screen.
  await recordPlayer(page);
  await prev();
  const back = page2.find((w) => w.startMs > page2[0].startMs + 1500)!;
  await playUntil(page, back.startMs + 300);
  const { frames } = await recording(page);
  expect(frames.some((f) => f[6] === "epubcfi(/6/2)"), "the reader was on page 1 for a while").toBe(true);
  const lit = frames.filter((f) => f[0] * 1000 >= back.startMs && f[3]);
  expect(lit.length, `"${back.word}" lit`).toBeGreaterThan(0);
  expect(lit.every((f) => f[6] === "epubcfi(/6/4)" && f[8] === true)).toBe(true);

  // Paused, the reader turns back again; Play goes on with page 2 shown and the word lit.
  await bar.getByRole("button", { name: "Pause" }).click();
  const word = await bar.getAttribute("data-word");
  await prev();
  await expect(reader).toHaveAttribute("data-cfi", "epubcfi(/6/2)");
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(reader).toHaveAttribute("data-cfi", "epubcfi(/6/4)");
  await expect.poll(() => litNow(page), { timeout: 5000 }).not.toBeNull();
  expect(page2.map((w) => w.word)).toContain(word);
  await bar.getByRole("button", { name: "Pause" }).click();
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${importId}`)).status()).toBe(204);
});

test("M13 (e): on a PDF page printed sideways, the word being read is lit over its letters", async ({ page }) => {
  test.setTimeout(90_000);
  const { PDFDocument, StandardFonts, degrees } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("A Page Turned Sideways");
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const pdfPage = doc.addPage([612, 792]);
  const lines = ["A table too wide for the page is often printed", "across it, and the page is turned a quarter", "turn so that it can be read on its side."];
  lines.forEach((line, k) => pdfPage.drawText(line, { x: 72, y: 700 - 15 * k, size: 12, font }));
  // Shown a quarter turn clockwise: as a landscape page, its lines running down.
  pdfPage.setRotation(degrees(90));
  const bytes = new Uint8Array(await doc.save({ useObjectStreams: false }));
  const ps = (await extractPdfSections(bytes)).filter((x) => x.kind === "paragraph");
  expect(ps.map((p) => p.text)).toEqual([lines.join(" ")]);
  const pkg = buildPackage({ bookBytes: bytes, title: "Sideways", chapters: [{ title: "One", paragraphs: [ps[0].text, TAIL], inBook: [0, null] }] });
  const upload = await page.request.post("/api/books", { multipart: { files: { name: "sideways.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) } } });
  const bookId = (await upload.json()).results[0].bookId as string;
  const res = await page.request.post(`/api/books/${bookId}/readalong`, { data: Buffer.from(pkg.zip()), headers: { "content-type": "application/zip" } });
  const imp = (await res.json()).import;
  expect(imp.status).toBe("ready");
  const timings = JSON.parse(Buffer.from(pkg.files["timings/01.json"]).toString()).words as { w: string; start: number }[];
  const word = timings.find((w) => w.w === "wide")!;

  // Where "wide" is printed, on the page as shown (points), from pdf.js's own page geometry.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/` });
  const viewport = (await (await task.promise).getPage(1)).getViewport({ scale: 1 });
  const x0 = 72 + font.widthOfTextAtSize("A table too ", 12);
  const [ax, ay] = viewport.convertToViewportPoint(x0, 700);
  const [bx, by] = viewport.convertToViewportPoint(x0 + font.widthOfTextAtSize("wide", 12), 700);
  await task.destroy();
  expect(viewport.width).toBe(792);
  expect(Math.abs(ax - bx)).toBeLessThan(0.01); // the line runs down the page as shown

  await page.goto(`/books/${bookId}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, word.start * 1000 + 50);
  await page.evaluate(() => document.querySelector("audio")!.pause());
  await expect(bar).toHaveAttribute("data-word", "wide");
  await expect.poll(() => litNow(page), { timeout: 5000 }).toBe("wide");
  const box = (await litBox(page, 792))!;
  // The lit box runs down the page along the printed word, and lies across its line.
  expect(box.height, `lit ${box.width.toFixed(1)} pt wide, ${box.height.toFixed(1)} pt high`).toBeGreaterThan(box.width);
  expect(Math.abs(box.top - Math.min(ay, by)), `lit from ${box.top.toFixed(1)} pt down, printed from ${Math.min(ay, by).toFixed(1)}`).toBeLessThan(4);
  expect(Math.abs(box.height - Math.abs(by - ay)), `lit ${box.height.toFixed(1)} pt long, printed ${Math.abs(by - ay).toFixed(1)}`).toBeLessThan(4);
  expect(ax, `the line at ${ax.toFixed(1)} pt, lit from ${box.left.toFixed(1)} to ${(box.left + box.width).toFixed(1)}`).toBeGreaterThan(box.left - 2);
  expect(ax).toBeLessThan(box.left + box.width + 2);
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
});

test("M13 (e): a PDF page whose picture could not be drawn (no canvas memory left) is drawn when asked for again at the same size", async ({ page }) => {
  // The page's picture gets no canvas until the test says so, as when an iPhone has used up its canvas memory.
  await page.addInitScript(() => {
    const w = window as unknown as { noCanvas_: boolean };
    w.noCanvas_ = true;
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      // pdf.js asks for its own canvases with options; the page's picture without.
      if (w.noCanvas_ && type === "2d" && rest.length === 0 && this.width > 300) return null;
      return (get as (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof get;
  });
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  const pdf = books.find((b) => b.title === "Discourse on the Method")!;
  await page.goto(`/books/${pdf.id}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const shown = () =>
    page.evaluate(() => {
      const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document | null }[] } };
      const doc = view.renderer.getContents()[0]?.doc;
      return { picture: !!doc?.querySelector("#canvas canvas"), text: doc?.querySelector(".textLayer span") !== null && !!doc };
    });
  // No picture, but the page's text is there (and so is the word being read, when there is one).
  await expect.poll(shown, { timeout: 10_000 }).toEqual({ picture: false, text: true });
  // Memory again; the page shown asked for again at the same size (foliate does this when the shown
  // page is chosen again; the book opens where it was last read, so not necessarily page 1): drawn now.
  await page.evaluate(() => {
    (window as unknown as { noCanvas_: boolean }).noCanvas_ = false;
    const view = document.querySelector("foliate-view") as unknown as { goTo(i: number): Promise<void>; renderer: { getContents(): { doc: Document | null }[] } };
    return view.goTo(Number(view.renderer.getContents()[0].doc!.documentElement.dataset.page));
  });
  await expect.poll(shown, { timeout: 10_000 }).toEqual({ picture: true, text: true });
});

test("M13 (e): in a PDF without an audiobook, Listen says how to add one", async ({ page }) => {
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  const pdf = books.find((b) => b.title === "Discourse on the Method")!;
  await page.goto(`/books/${pdf.id}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar).toContainText("In a PDF book, Listen plays your own audiobook: add one on the book's page.");
  await expect(bar.getByRole("button", { name: "Play" })).toBeDisabled();
});

// M14 step 6b: away from the reader, a mini-player at the foot of every page reads on.
// An audiobook of 30 paragraphs (a few minutes), so 15 s skips stay inside it.
async function miniReading(page: Page) {
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([{ title: "Mini", said: PARAGRAPHS.slice(40, 70).map((_, k) => 40 + k) }], "Mini reading");
  await importReading(page, bookId, zip(), expected);
  return { bookId, expected };
}
const audioTime = (page: Page) => page.evaluate(() => document.querySelector("audio")!.currentTime);

test("M14 (6b): leaving the reader, the mini-player reads on: the sentence with its word lit, 15 s back and forward, and back to the page", async ({ page }) => {
  test.setTimeout(120_000);
  const { bookId, expected } = await miniReading(page);
  const bar = await openListening(page, bookId, 40);
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, expected[3].startMs + 100);

  await page.getByRole("link", { name: "Back to your library" }).click();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini).toBeVisible();
  await expect(mini).toContainText("The Strange Case of Dr. Jekyll and Mr. Hyde");
  await expect(mini.getByRole("button", { name: "Pause" })).toBeVisible();
  // The word being said, inside its sentence, moves on in reading order.
  const seen: string[] = [];
  await expect
    .poll(
      async () => {
        const w = await mini.locator("mark").textContent().catch(() => null);
        if (w && seen.at(-1) !== w) seen.push(w);
        return seen.length;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(3);
  let k = 0;
  for (const w of seen) {
    while (k < expected.length && expected[k].word !== w) k++;
    expect(k, `"${w}" in reading order, among ${seen.join(" ")}`).toBeLessThan(expected.length);
  }
  // (innerText: the sentence as shown; the phone's shorter one is in the page but hidden.)
  const sentence = await mini.locator("p").first().innerText();
  expect(PARAGRAPHS.slice(40, 70).some((p) => p.text.includes(sentence!.replace(/^…/, "").trim().slice(0, 40)))).toBe(true);

  // Forward 15 s, then back 15 s: the time read just before and after the click, in one step in the page, so
  // the audio playing on while the test waits does not count.
  const skip = (name: string) =>
    page.evaluate((name) => {
      const audio = document.querySelector("audio")!;
      const before = audio.currentTime;
      document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click();
      return [before, audio.currentTime];
    }, name);
  const [t0, t1] = await skip("Forward 15 seconds");
  expect(t1 - t0).toBeCloseTo(15, 1);
  // The reading position follows the voice into the paragraph it now reads (listening counts as reading).
  const cfis = PARAGRAPHS.slice(41, 70).map((p) => p.cfi);
  await expect
    .poll(async () => {
      const books = (await (await page.request.get("/api/export")).json()).books as { id: string; position: string | null }[];
      return cfis.includes(books.find((b) => b.id === bookId)!.position ?? "");
    })
    .toBe(true);
  const [tb, t2] = await skip("Back 15 seconds");
  expect(tb - t2).toBeCloseTo(15, 1);
  // ...and the lit word goes back with it (once the seek is done).
  const near = expected.filter((w) => w.startMs >= t2 * 1000 - 500 && w.startMs <= t2 * 1000 + 4000).map((w) => w.word);
  await expect.poll(async () => near.includes((await mini.locator("mark").textContent()) ?? ""), { timeout: 10_000 }).toBe(true);
  // At the start of the file, back 15 s stops at its start.
  await page.evaluate(() => (document.querySelector("audio")!.currentTime = 5));
  await mini.getByRole("button", { name: "Back 15 seconds" }).click();
  expect(await audioTime(page)).toBeLessThan(1);

  // Go to the page: the reader opens there, its own bar playing, the word lit; no mini-player in the reader.
  await mini.getByRole("link", { name: "Go to the page" }).click();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const back = page.getByRole("region", { name: "Read aloud" });
  await expect(back.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(back).toHaveAttribute("data-word", /\S+/);
  await expect(page.getByRole("region", { name: "Now playing" })).toHaveCount(0);
  await back.getByRole("button", { name: "Stop reading aloud" }).click();
  await expect(page.locator("audio")).toHaveCount(0);
});

test("M14 (6b): paused in the reader, then left: the mini-player shows where the audio is, not where Listen began", async ({ page }) => {
  test.setTimeout(90_000);
  const { bookId, expected } = await miniReading(page);
  const bar = await openListening(page, bookId, 40);
  // It plays (so it goes on after the reader), then is paused, and moved on into the third paragraph while
  // paused. (Moved while playing, WebKit on Linux once stood still after the seek: CI run 37478603601.)
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await bar.getByRole("button", { name: "Pause" }).click();
  await expect(bar.getByRole("button", { name: "Play" })).toBeVisible();
  const k = expected.findIndex((w) => w.cfi === PARAGRAPHS[42].cfi);
  await page.evaluate((t) => (document.querySelector("audio")!.currentTime = t), (expected[k + 3].startMs + 50) / 1000);
  await expect(bar).toHaveAttribute("data-word", expected[k + 3].word);
  const word = expected[k + 3].word;

  await page.getByRole("link", { name: "Back to your library" }).click();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  // The paragraph and the word where it was paused, and the minutes left.
  const sentence = (await mini.locator("p").first().innerText()).replace(/^…/, "").trim();
  expect(PARAGRAPHS[42].text).toContain(sentence.slice(0, 30));
  await expect(mini.locator("mark")).toHaveText(word!);
  await expect(mini).toContainText("min left");
});

test("M14 (6b): Listen from here on Home plays the book's own audiobook there, in the same tap, from the reading position", async ({ page }) => {
  test.setTimeout(90_000);
  const { bookId, expected } = await miniReading(page);
  // Jekyll was read last, and its place is paragraph 41 (inside the reading).
  expect((await page.request.put(`/api/books/${bookId}/position`, { data: { cfi: PARAGRAPHS[41].cfi, fraction: 0.3 } })).status()).toBe(204);
  await page.goto("/");
  const card = page.getByTestId("continue-card").filter({ hasText: "The Strange Case of Dr. Jekyll and Mr. Hyde" });
  const listen = card.getByRole("link", { name: "Listen from here" });
  // Ready to play here once its data has come (until then the link opens the reader).
  await expect(listen).toHaveAttribute("data-here", "");
  // Safari starts audio only from inside the tap: note whether play() is called while the click is still
  // being handled (from the document's first look at it to the window's last).
  await page.evaluate(() => {
    const w = window as unknown as { inTap: boolean; playedInTap: boolean[] };
    w.inTap = false;
    w.playedInTap = [];
    document.addEventListener("click", () => (w.inTap = true), true);
    window.addEventListener("click", () => (w.inTap = false));
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.playedInTap.push(w.inTap);
      return play.call(this);
    };
  });
  await listen.click();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { playedInTap: boolean[] }).playedInTap), "play() inside the tap").toEqual([true]);
  // Still on Home: no reader opened.
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByTestId("reader")).toHaveCount(0);
  // From the reading position: paragraph 41's words, lit in the mini-player as they are said.
  const first = expected.find((w) => w.cfi === PARAGRAPHS[41].cfi)!;
  // Its start is set once the file's length is known: wait for it, but not so long that audio started at 0
  // could get there by playing.
  await page.waitForFunction((t) => document.querySelector("audio")!.currentTime >= t, first.startMs / 1000 - 0.05, { timeout: 1_000 });
  await playUntil(page, first.startMs + 800);
  await expect(mini.locator("mark")).toBeVisible();
  const sentence = (await mini.locator("p").first().innerText()).replace(/^…/, "").trim();
  expect(PARAGRAPHS[41].text).toContain(sentence.slice(0, 30));

  // A second tap goes on with the book in the player, not back to where Home began: the same audio plays on.
  const before = await page.evaluate(() => {
    const a = document.querySelector("audio")!;
    (window as unknown as { heard: HTMLAudioElement }).heard = a;
    return a.currentTime;
  });
  await listen.click();
  await page.waitForFunction((t) => document.querySelector("audio")!.currentTime > t + 0.2, before);
  const same = () => page.evaluate(() => document.querySelector("audio") === (window as unknown as { heard: HTMLAudioElement }).heard);
  expect(await same()).toBe(true);
  // Paused, a tap goes on from there.
  await mini.getByRole("button", { name: "Pause" }).click();
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const paused = await audioTime(page);
  await listen.click();
  await expect(mini.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(await audioTime(page)).toBeGreaterThanOrEqual(paused);
  expect(await same()).toBe(true);
});

test("M14 (6b): a listen started on Home that cannot play says so in the mini-player", async ({ page }) => {
  test.setTimeout(60_000);
  const { bookId } = await miniReading(page);
  expect((await page.request.put(`/api/books/${bookId}/position`, { data: { cfi: PARAGRAPHS[41].cfi, fraction: 0.3 } })).status()).toBe(204);
  await page.goto("/");
  const card = page.getByTestId("continue-card").filter({ hasText: "The Strange Case of Dr. Jekyll and Mr. Hyde" });
  const listen = card.getByRole("link", { name: "Listen from here" });
  await expect(listen).toHaveAttribute("data-here", "");
  // The audiobook's audio cannot be fetched.
  await page.route("**/readalong/**/audio/**", (r) => r.abort());
  await listen.click();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini.getByRole("status").first()).toContainText("could not be played");
});

test("M14 (6b): 15 s skips go on into the next audio file, and back into the one before", async ({ page }) => {
  test.setTimeout(90_000);
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([
    { title: "One", said: [32, OUTRO] },
    { title: "Two", said: ["Chapter Two. Search for Mr. Hyde.", 33] },
  ]);
  await importReading(page, bookId, zip(), expected);
  const bar = await openListening(page, bookId, 32);
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await bar.getByRole("button", { name: "Pause" }).click();
  await expect(bar.getByRole("button", { name: "Play" })).toBeVisible();
  // Moved, while paused, to paragraph 32's last word: a few seconds before the first file is left.
  const last32 = expected.filter((w) => w.cfi === PARAGRAPHS[32].cfi).at(-1)!;
  const t0 = last32.startMs + 50;
  await page.evaluate((t) => (document.querySelector("audio")!.currentTime = t), t0 / 1000);
  await expect(bar).toHaveAttribute("data-word", last32.word);
  // Where that word ends (the fixture times every character), and where playing leaves the first file: 6 s later,
  // or at its end.
  const end32 = last32.startMs + last32.word.length * SECONDS_PER_CHAR * 1000;
  const leave = Math.min(await page.evaluate(() => document.querySelector("audio")!.duration * 1000), end32 + SKIP_GAP_MS);
  await page.getByRole("link", { name: "Back to your library" }).click();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const where = () =>
    page.evaluate(() => {
      const a = document.querySelector("audio")!;
      return { file: Number(/\/audio\/(\d+)$/.exec(a.getAttribute("src") ?? "")?.[1]), t: a.currentTime, paused: a.paused };
    });
  const shows = async (i: number) => PARAGRAPHS[i].text.includes((await mini.locator("p").first().innerText()).replace(/^…/, "").trim().slice(0, 30));

  // Forward 15 s: on into the second file (what was left of the first counted), still paused; the bar follows.
  await mini.getByRole("button", { name: "Forward 15 seconds" }).click();
  await expect.poll(async () => (await where()).file).toBe(1);
  await expect.poll(async () => (await where()).t).toBeGreaterThan(0);
  const there = await where();
  expect(there.paused).toBe(true);
  // What was left after the first file, from the second file's start (its first paragraph is within 6 s of it).
  expect(there.t).toBeCloseTo((t0 + 15_000 - leave) / 1000, 1);
  await expect.poll(() => shows(33)).toBe(true);

  // Back 15 s from 13.5 s into the second file: 1.5 s back from the end of paragraph 32's last word, still paused.
  await page.evaluate(() => (document.querySelector("audio")!.currentTime = 13.5));
  await expect.poll(async () => (await where()).t).toBeCloseTo(13.5, 1);
  await mini.getByRole("button", { name: "Back 15 seconds" }).click();
  await expect.poll(async () => (await where()).file).toBe(0);
  await expect.poll(async () => (await where()).t).toBeCloseTo((end32 + WORD_TAIL_MS - 1_500) / 1000, 1);
  await expect.poll(() => shows(32)).toBe(true);
  expect((await where()).paused).toBe(true);
});

// M14, back into a chapter not loaded: Listen opened further on gets the audiobook's paragraphs from there on only.
// Going back past the first of them, the player first asks for the part before (…/reading?before=<position>), then
// lands where it lands with that part loaded. A reading of two files: paragraphs 40 to 57, then, after a spoken
// heading, 58 to 69 (69 a long one, 37 s).
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k);
async function backInto(page: Page, at: 58 | 69) {
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([
    { title: "One", said: range(40, 57) },
    { title: "Two", said: ["Chapter Two.", ...range(58, 69)] },
  ]);
  await importReading(page, bookId, zip(), expected);
  // Listen from here on Home, the reading position at paragraph `at`: it starts exactly there (the reader would start
  // at the first paragraph on its page).
  expect((await page.request.put(`/api/books/${bookId}/position`, { data: { cfi: PARAGRAPHS[at].cfi, fraction: 0.5 } })).status()).toBe(204);
  const prepared = page.waitForResponse((r) => r.url().includes(`/api/books/${bookId}/audio?`) && new URL(r.url()).searchParams.get("cfi") === PARAGRAPHS[at].cfi);
  await page.goto("/");
  // What the player gets: the second file's paragraphs from `at` on only, and that more of the audiobook comes before.
  const info = await (await prepared).json();
  expect((info.audiobook.paragraphs as { cfi: string; file: number }[]).map((p) => [p.cfi, p.file])).toEqual(range(at, 69).map((i) => [PARAGRAPHS[i].cfi, 1]));
  expect(info.audiobook.earlier).toEqual(expect.any(Number));
  const listen = page.getByTestId("continue-card").filter({ hasText: "The Strange Case of Dr. Jekyll and Mr. Hyde" }).getByRole("link", { name: "Listen from here" });
  await expect(listen).toHaveAttribute("data-here", "");
  await listen.click();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini.getByRole("button", { name: "Pause" })).toBeVisible();
  const said = (i: number) => expected.filter((w) => w.cfi === PARAGRAPHS[i].cfi);
  // Where the first file's last word ends (paragraph 57's; the fixture times every character).
  const last = said(57).at(-1)!;
  return {
    mini,
    said,
    end57: last.startMs + last.word.length * SECONDS_PER_CHAR * 1000,
    /** The paragraph, of `from` to `to`, that time `ms` of their file is in (the last one begun by then). */
    inside: (ms: number, from: number, to: number) => range(from, to).filter((i) => said(i)[0].startMs <= ms).at(-1)!,
    /**
     * The part before is asked for (waited for from before the click that asks, so it is not missed). Not asked
     * within 10 s: the error says what the player was doing, since a Back press is ignored while the audio element
     * has no data or is seeking (skip's guard), which WebKit on CI can be in for a moment after a far seek.
     */
    asksBefore: () =>
      page.waitForRequest((r) => /\/reading\?before=\d+$/.test(r.url()), { timeout: 10_000 }).catch(async (e: Error) => {
        const state = await page
          .evaluate(() => {
            const a = document.querySelector("audio")!;
            return { currentTime: a.currentTime, paused: a.paused, seeking: a.seeking, readyState: a.readyState, networkState: a.networkState };
          })
          .catch(() => "unknown");
        throw new Error(`${e.message}\nThe part before was not asked for. The player: ${JSON.stringify(state)}`);
      }),
    /** Waits until the audio element has data and is not seeking: a Back press before that is ignored (skip's guard). */
    ready: () =>
      page.waitForFunction(
        () => {
          const a = document.querySelector("audio")!;
          return a.readyState >= 2 && !a.seeking;
        },
        undefined,
        { timeout: 10_000 },
      ),
    where: () =>
      page.evaluate(() => {
        const a = document.querySelector("audio")!;
        return { file: Number(/\/audio\/(\d+)$/.exec(a.getAttribute("src") ?? "")?.[1]), t: a.currentTime, paused: a.paused };
      }),
    shows: async (i: number) => PARAGRAPHS[i].text.includes((await mini.locator("p").first().innerText()).replace(/^…/, "").trim().slice(0, 30)),
  };
}

test("M14: Back 15 s from where Listen began goes on back into the audio file before, though its part was not loaded; paused, it stays paused", async ({ page }) => {
  test.setTimeout(90_000);
  const { mini, end57, inside, asksBefore, where, shows } = await backInto(page, 58);
  await mini.getByRole("button", { name: "Pause" }).click();
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  // 13.5 s into the second file, paused.
  await page.evaluate(() => (document.querySelector("audio")!.currentTime = 13.5));
  await expect.poll(async () => (await where()).t).toBeCloseTo(13.5, 1);
  await expect.poll(() => shows(inside(13_500, 58, 69))).toBe(true);
  // Back 15 s: the part before is asked for; then, as with it loaded all along, 1.5 s back from the end of the first
  // file's last word (plus its 0.25 s tail), in the first file, still paused.
  const asked = asksBefore();
  await mini.getByRole("button", { name: "Back 15 seconds" }).click();
  await asked;
  await expect.poll(async () => (await where()).file).toBe(0);
  const landing = end57 + WORD_TAIL_MS - 1_500;
  await expect.poll(async () => (await where()).t).toBeCloseTo(landing / 1000, 1);
  await expect.poll(() => shows(inside(landing, 40, 57))).toBe(true);
  expect((await where()).paused).toBe(true);
});

test("M14: Back 15 s from where Listen began, while playing: back into the audio file before, at the time counted from the press, playing on", async ({ page }) => {
  test.setTimeout(90_000);
  const { mini, said, end57, inside, asksBefore, where, shows } = await backInto(page, 58);
  await playUntil(page, said(58)[0].startMs + 500);
  // Every time the player sets on the audio from here on (the landing in the first file is set once its length is known).
  await page.evaluate(() => {
    const w = window as unknown as { sets_: number[] };
    w.sets_ = [];
    const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: time.get,
      set(this: HTMLMediaElement, t: number) {
        w.sets_.push(t);
        time.set!.call(this, t);
      },
    });
  });
  // Back 15 s, the time read in the same step as the press (the audio plays on while the test waits).
  const asked = asksBefore();
  const t0 = await page.evaluate(() => {
    const t = document.querySelector("audio")!.currentTime;
    document.querySelector<HTMLButtonElement>('[aria-label="Back 15 seconds"]')!.click();
    return t;
  });
  // Less than 15 s into the second file (its first paragraph is within 6 s of its start): Back goes on into the first.
  expect(t0).toBeLessThan(15);
  await asked;
  await expect.poll(async () => (await where()).file).toBe(0);
  // Where: the t0 seconds of the second file, then the rest of the 15 s back from the end of the first file's last word.
  const landing = end57 + WORD_TAIL_MS - (15_000 - t0 * 1000);
  await expect.poll(() => page.evaluate(() => (window as unknown as { sets_: number[] }).sets_[0] ?? null)).toBeCloseTo(landing / 1000, 2);
  // In the paragraph that time is in, shown in the mini-player, playing on from there.
  await expect.poll(() => shows(inside(landing, 40, 57))).toBe(true);
  await page.waitForFunction((t) => document.querySelector("audio")!.currentTime > t, landing / 1000 + 0.3, { timeout: 10_000 });
  expect(await where()).toMatchObject({ file: 0, paused: false });
  await expect(mini.getByRole("button", { name: "Pause" })).toBeVisible();
});

test("M14: back past where Listen began within the same audio file lands 15 s back, and shows and lights the paragraph it lands in", async ({ page }) => {
  test.setTimeout(90_000);
  const { mini, said, inside, asksBefore, where, shows } = await backInto(page, 69);
  await mini.getByRole("button", { name: "Pause" }).click();
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  // 14 s into paragraph 69, paused.
  const t = said(69)[0].startMs + 14_000;
  await page.evaluate((t) => (document.querySelector("audio")!.currentTime = t), t / 1000);
  await expect.poll(async () => (await where()).t).toBeCloseTo(t / 1000, 1);
  await expect.poll(() => shows(69)).toBe(true);
  const asked = asksBefore();
  await mini.getByRole("button", { name: "Back 15 seconds" }).click();
  await asked;
  // 15 s back in the same file (nothing there is jumped over), 1 s before paragraph 69: in 68, which was not loaded,
  // shown with the word said there lit; still paused.
  const landing = t - 15_000;
  await expect.poll(async () => (await where()).t).toBeCloseTo(landing / 1000, 1);
  expect(inside(landing, 58, 69)).toBe(68);
  await expect.poll(() => shows(68)).toBe(true);
  const near = said(68)
    .filter((w) => Math.abs(w.startMs - landing) < 1_000)
    .map((w) => w.word);
  expect(near.length).toBeGreaterThan(0);
  await expect.poll(async () => near.includes((await mini.locator("mark").textContent()) ?? "")).toBe(true);
  expect(await where()).toMatchObject({ file: 1, paused: true });
});

// The part before never comes (the connection stalled): the request is given up after LOOK_BACK_MS. Until then
// Back and Forward wait; then the skip lands within what is loaded, counted from where the audio is by then (not
// from the press, LOOK_BACK_MS earlier), and both buttons work again.
test("M14: the part before never comes: after the wait's limit, Back lands 15 s back from where the audio is by then, and Forward works again", async ({ page }) => {
  test.setTimeout(90_000);
  const { mini, said, asksBefore, ready, where } = await backInto(page, 69);
  await mini.getByRole("button", { name: "Pause" }).click();
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  // 10 s into paragraph 69 (37 s long: room for the wait and both skips), then playing on from there. Back 15 s must
  // land before 69 to ask for the part before: 10 s leaves 5 s of slack for the steps between the audio reaching the
  // point and the press. With 14 s the slack was 0.5 s, and on a slow WebKit runner the press came too late: the
  // skip stayed inside 69 and nothing was asked for (#104 runs 37638918531 attempts 2 and 4, #110 run 37643052389:
  // "The player: currentTime 36.5, not paused, not seeking, readyState 4").
  const t = said(69)[0].startMs + 10_000;
  await page.evaluate((t) => (document.querySelector("audio")!.currentTime = t), t / 1000);
  await expect.poll(async () => (await where()).t).toBeCloseTo(t / 1000, 1);
  await mini.getByRole("button", { name: "Play", exact: true }).click();
  await playUntil(page, t + 500);
  // After a far seek, WebKit on CI can still be short of data for a moment: a Back pressed then is ignored.
  await ready();
  // Every time the player sets the audio's time from here on: the time just before, and the time set.
  await page.evaluate(() => {
    const w = window as unknown as { sets_: [number, number][] };
    w.sets_ = [];
    const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: time.get,
      set(this: HTMLMediaElement, to: number) {
        w.sets_.push([this.currentTime, to]);
        time.set!.call(this, to);
      },
    });
  });
  const sets = () => page.evaluate(() => (window as unknown as { sets_: [number, number][] }).sets_);
  // The part before is asked for, and the answer never comes (the request is let go at the end, failed or not:
  // held, it keeps the page from closing).
  let held: Route | null = null;
  await page.route(/\/reading\?before=\d+$/, (route) => {
    held = route;
  });
  try {
    const asked = asksBefore();
    const t0 = (await where()).t;
    await mini.getByRole("button", { name: "Back 15 seconds" }).click();
    await asked;
    // Meanwhile Forward does nothing (the wait holds both buttons), while the audio plays on.
    await mini.getByRole("button", { name: "Forward 15 seconds" }).click();
    expect(await sets()).toEqual([]);
    // Past the limit, the skip lands: 15 s back from where the audio was at that moment, so inside paragraph 69
    // still (counted from the press it would land before 69, in the part that never came).
    await expect.poll(async () => (await sets()).length, { timeout: LOOK_BACK_MS + 15_000 }).toBe(1);
    const [[was, landed]] = await sets();
    expect(was, "the audio played on through the wait").toBeGreaterThan(t0 + LOOK_BACK_MS / 1000 - 2);
    expect(was - landed).toBeCloseTo(15, 1);
    expect(landed).toBeGreaterThan(said(69)[0].startMs / 1000);
    // Forward works again at once: 15 s on from where it is.
    await mini.getByRole("button", { name: "Forward 15 seconds" }).click();
    await expect.poll(async () => (await sets()).length).toBe(2);
    const [, [before, after]] = await sets();
    expect(after - before).toBeCloseTo(15, 1);
    expect(await where()).toMatchObject({ file: 1, paused: false });
  } finally {
    await page.unroute(/\/reading\?before=\d+$/);
    await (held as Route | null)?.abort().catch(() => {});
  }
});

test("M14 (6b): the speed is chosen from the mini-player's menu, and kept on this device for the next listen", async ({ page }) => {
  test.setTimeout(90_000);
  const { bookId, expected } = await miniReading(page);
  const bar = await openListening(page, bookId, 40);
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, expected[1].startMs + 100);
  await page.getByRole("link", { name: "Back to your library" }).click();
  const mini = page.getByRole("region", { name: "Now playing" });
  const pill = mini.getByRole("button", { name: "Playback speed: 1.0 times" });
  await pill.click();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  const menu = mini.getByRole("group", { name: "Choose a speed" });
  await expect(menu.getByRole("button")).toHaveText(["0.75×", "1.0×", "1.25×", "1.5×", "1.75×", "2.0×"]);
  await expect(menu.getByRole("button", { name: "1.0×" })).toHaveAttribute("aria-pressed", "true");
  await menu.getByRole("button", { name: "1.5×" }).click();
  await expect(menu).toHaveCount(0);
  await expect(mini.getByRole("button", { name: "Playback speed: 1.5 times" })).toBeFocused();
  expect(await page.evaluate(() => document.querySelector("audio")!.playbackRate)).toBe(1.5);
  await expect(mini).toContainText("at 1.5×");
  // Escape closes the menu.
  await mini.getByRole("button", { name: "Playback speed: 1.5 times" }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // A new page load ends the session; the next Listen starts at 1.5x.
  const again = await openListening(page, bookId, 40);
  await expect(again.getByLabel("Speed")).toHaveValue("1.5");
  await again.getByRole("button", { name: "Play" }).click();
  await expect(again.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(await page.evaluate(() => document.querySelector("audio")!.playbackRate)).toBe(1.5);
  await again.getByRole("button", { name: "Stop reading aloud" }).click();
});

test("M14 (6b): the mini-player sits at the foot of the page, above the tabs on a phone, hides nothing, and looks right", async ({ page }) => {
  test.setTimeout(120_000);
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const { mkdir } = await import("node:fs/promises");
  await mkdir("screenshots", { recursive: true });
  const { bookId, expected } = await miniReading(page);
  const bar = await openListening(page, bookId, 40);
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, expected[2].startMs + 100);
  await page.getByRole("link", { name: "Back to your library" }).click();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini.locator("mark")).toBeVisible();
  // Held still, so every look shows the same word.
  await mini.getByRole("button", { name: "Pause" }).click();
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      // At the top of the long page the bar is on screen (held at the foot)...
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(mini).toBeInViewport();
      // ...and at its end it hides nothing: the page ends above it, and it ends above the tabs.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const box = (await mini.boundingBox())!;
      const content = (await page.locator("#content").boundingBox())!;
      expect(content.y + content.height, `${name}: the page ends above the mini-player`).toBeLessThanOrEqual(box.y + 1);
      if (name === "phone") {
        const tabs = (await page.getByRole("navigation", { name: "Tabs" }).boundingBox())!;
        expect(box.y + box.height, "the mini-player ends above the tabs").toBeLessThanOrEqual(tabs.y + 1);
        // The speed menu opens on the screen, every speed in reach.
        await mini.getByRole("button", { name: "Playback speed: 1.0 times" }).click();
        for (const choice of await mini.getByRole("group", { name: "Choose a speed" }).getByRole("button").all()) {
          const c = (await choice.boundingBox())!;
          expect(c.x, `${await choice.textContent()} on the screen`).toBeGreaterThanOrEqual(0);
          expect(c.x + c.width, `${await choice.textContent()} on the screen`).toBeLessThanOrEqual(w);
        }
        await page.keyboard.press("Escape");
        await expect(mini.getByRole("group", { name: "Choose a speed" })).toHaveCount(0);
        await expect(mini.getByRole("button", { name: "Playback speed: 1.0 times" })).toBeFocused();
        // The minutes left are never cut short, however long the title and chapter (a chapter name 4 times as long, for a moment).
        const left = mini.getByText(/min left/);
        const shown = () => left.evaluate((e) => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().right <= e.parentElement!.getBoundingClientRect().right + 0.5);
        expect(await shown()).toBe(true);
        const chapter = mini.getByText("Search for Mr. Hyde", { exact: true });
        await chapter.evaluate((e) => (e.textContent = "Search for Mr. Hyde ".repeat(4).trim()));
        expect(await shown()).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "a long chapter name: no sideways scroll").toBe(true);
        await mini.getByText(/Search for Mr\. Hyde Search/).evaluate((e) => (e.textContent = "Search for Mr. Hyde"));
        // The photo without the focus ring Escape leaves on the pill.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      } else {
        expect(box.x, "beside the sidebar, not over it").toBeGreaterThanOrEqual(256);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (scheme === "light") {
        // Keyboard focus is never left behind the bar: a link or button it covers, once focused, is scrolled clear of it.
        await page.evaluate(() => window.scrollTo(0, 0));
        const focused = await page.evaluate(() => {
          const bar = () => document.querySelector("[data-miniplayer]")!.getBoundingClientRect();
          const under = [...document.querySelectorAll<HTMLElement>("#content a[href], #content button")].find((e) => {
            const r = e.getBoundingClientRect();
            return r.height > 0 && r.bottom > bar().top + 1 && r.top < window.innerHeight;
          });
          if (!under) return "nothing under the bar";
          under.focus();
          return under.getBoundingClientRect().bottom <= bar().top + 1 ? "clear of the bar" : `behind the bar: ${under.textContent}`;
        });
        expect(focused, name).toBe("clear of the bar");
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      }
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      await page.screenshot({ path: `screenshots/miniplayer-${name}-${scheme}${engine()}.png` });

      // Think aloud (M14 step 6c): its panel opens above the bar, on the screen, and is accessible.
      await mini.getByRole("button", { name: "Think aloud" }).click();
      const think = mini.getByRole("region", { name: "Think aloud" });
      await expect(think.getByRole("button", { name: "Record" })).toBeVisible();
      const p = (await think.boundingBox())!;
      expect(p.x, `${name}: the panel on the screen`).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width, `${name}: the panel on the screen`).toBeLessThanOrEqual(w);
      expect(p.y + p.height, `${name}: above the bar`).toBeLessThanOrEqual((await mini.locator("p").first().boundingBox())!.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const withPanel = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(withPanel.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/thinkaloud-${name}-${scheme}${engine()}.png` });
      await think.getByRole("button", { name: "Back" }).click();
      await expect(think).toHaveCount(0);
    }
  }
  // An iPad held upright (820 wide, beside the sidebar): no swatch or spacer, and Go to the page as its icon, so the
  // book's title keeps its room.
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(mini.getByRole("link", { name: "Go to the page" })).toBeVisible();
  const title = (await mini.getByText("The Strange Case of Dr. Jekyll and Mr. Hyde", { exact: true }).boundingBox())!;
  expect(title.width, "the title keeps its room").toBeGreaterThan(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `screenshots/miniplayer-tablet${engine()}.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
});

