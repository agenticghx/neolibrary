import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { extractPdfSections } from "@/lib/library/pdf-sections";
import { extractSections, type Section } from "@/lib/library/sections";
import { buildPackage } from "@/lib/readalong/fixture";
import { expectEveryWordOnTime, expectNoStall, recording, recordPlayer, type Spoken } from "./listen";
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

const BOOK = new Uint8Array(readFileSync("fixtures/books/stevenson-jekyll-and-hyde.epub"));

test("an audiobook package is uploaded in parts, checked, and becomes read-aloud tracks; it can be removed", async ({ page }) => {
  await page.goto("/shelf");
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
  await page.goto("/shelf");
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
  await page.goto("/shelf");
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

  await page.goto("/shelf");
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
  await folder.setInputFiles(root);
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
  await section.getByLabel("Replace with another folder").setInputFiles(root);
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
  await page.goto("/shelf");
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
  await section.getByLabel("Choose the read-along folder").setInputFiles(root);
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

  // Cancel in the middle of sending: the page says so, and the unfinished upload can be removed.
  partDelay = 20_000; // held while the screen is checked, then cancelled
  await section.getByLabel("Choose the read-along folder").setInputFiles(root);
  const cancel = section.getByRole("button", { name: "Cancel the upload" });
  // Wait until the audio is being sent (the upload exists on the server).
  await expect(section.getByTestId("audiobook-status")).toHaveText(/^Sending the audio/);
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
});

// The upload routes skip proxy.ts (so large bodies are not cut at 10 MB);
// they must still refuse a signed-out upload, before reading it.
test("a signed-out upload of 12 MB is refused by the upload routes themselves", async ({ page, browser }) => {
  await page.goto("/shelf");
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
  await page.goto("/shelf");
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

const playUntil = (page: Page, ms: number) =>
  page.waitForFunction((t) => document.querySelector("audio")!.currentTime * 1000 >= t, ms, { timeout: 45_000 });

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
  await page.goto("/shelf");
  const onShelf = page.getByTestId("shelf").getByRole("listitem").filter({ hasText: "Read-Along Test Pages" });
  await expect(onShelf.getByText("Read and listen", { exact: true })).toBeVisible();

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
  const { frames, events } = await recording(page);
  await page.evaluate(() => document.querySelector("audio")!.pause());

  // Every word, in order, each within a tenth of a second, lit in the page's own text layer and on screen:
  // page 2's first word too, though it follows page 1's last with no pause.
  const { paragraphs } = expectEveryWordOnTime(frames, expected, { minWords: expected.length, onScreen: true });
  expect(paragraphs).toEqual(["epubcfi(/6/2)", "epubcfi(/6/4)"]);
  // The page turned only once page 1's last word had been said.
  const turned = frames.find((f) => f[6] === "epubcfi(/6/4)");
  expect(turned, "the reader turned to page 2").toBeDefined();
  expect(turned![0] * 1000, "turned after page 1's last word").toBeGreaterThanOrEqual(last1.end * 1000);
  const litFirst = frames.find((f) => f[3] === expected[first2].word && f[6] === "epubcfi(/6/4)")!;
  console.log(
    `page 2 shown ${Math.round(turned![0] * 1000 - last1.end * 1000)} ms after page 1's last word ended; its first word lit ${Math.round(litFirst[0] * 1000 - expected[first2].startMs)} ms after it began`,
  );
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
