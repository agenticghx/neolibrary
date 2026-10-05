import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { extractSections } from "@/lib/library/sections";
import { buildPackage } from "@/lib/readalong/fixture";
import { expectEveryWordOnTime, recording, recordPlayer, type Spoken } from "./listen";
import { ADMIN_STATE } from "./pages";

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
test("a two-part upload is announced once, can be cancelled, and the PDF page says when it will play", async ({ page }) => {
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

  // A PDF book says its player comes in the next update.
  const pdf = books.find((b) => b.title === "Discourse on the Method")!;
  await page.goto(`/books/${pdf.id}`);
  await expect(page.getByRole("region", { name: "Your audiobook" })).toContainText("Playing it in a PDF book comes in the next update of the app");
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
// its own package (replacing the last) and removes it at the end.

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
  expect(placed.slice(0, expected.length)).toEqual(expected);
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

const playUntil = (page: Page, ms: number) =>
  page.waitForFunction((t) => document.querySelector("audio")!.currentTime * 1000 >= t, ms, { timeout: 45_000 });

test("M13 (d): an EPUB plays its audiobook straight on across paragraphs, lighting every word in order, on time", async ({ page }) => {
  test.setTimeout(120_000);
  const bookId = await jekyllId(page);
  // Short lines of dialogue in chapter 2, read after a spoken heading, with
  // a spoken aside the book does not print (a short untimed gap that plays
  // through), and one word the narrator skipped. (Paragraphs whose opening
  // words are not also earlier in the chapter: the matcher anchors a
  // chapter's audio at the first place its first four words agree.)
  const { zip, expected } = readAlong([{ title: "Search for Mr. Hyde", said: ["Search for Mr. Hyde.", 61, 62, 63, "He paused.", 64, 65, 66], notSpoken: ["hoarsely."] }]);
  const imp = await importReading(page, bookId, zip(), expected);
  expect(expected.map((w) => w.word)).not.toContain("hoarsely.");

  const bar = await openListening(page, bookId, 61);
  await expect(bar).toContainText("Your audiobook: free to play.");
  await expect(bar.getByLabel("Voice")).toHaveValue(`upload:${imp.id}`);
  await expect(bar.getByLabel("Voice").locator("option:checked")).toHaveText("Your audiobook");
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  await playUntil(page, expected.at(-1)!.startMs + 400);
  const { frames, events } = await recording(page);
  await page.evaluate(() => document.querySelector("audio")!.pause());

  // Every word, in order, each within a tenth of a second; all six paragraphs in turn.
  const { paragraphs } = expectEveryWordOnTime(frames, expected, { minWords: expected.length });
  expect(paragraphs).toEqual([61, 62, 63, 64, 65, 66].map((i) => PARAGRAPHS[i].cfi));
  // The skipped word never lit up.
  expect(frames.filter((f) => f[1].includes("hoarsely") || f[3]?.includes("hoarsely"))).toEqual([]);
  // One audio element, loaded once and never reloaded; no pause; no seek
  // after the first (to the reading position): the aside played through.
  const names = events.map((e) => e[0]);
  expect(names.filter((n) => n === "loadstart")).toHaveLength(1);
  expect(names).not.toContain("emptied");
  expect(names).not.toContain("abort");
  expect(names).not.toContain("error");
  expect(names).not.toContain("pause");
  expect(names.filter((n) => n === "seeking").length).toBeLessThanOrEqual(1);
  const started = frames.findIndex((f) => !f[4]);
  expect(frames.slice(started).filter((f) => f[4])).toEqual([]);

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
      await expect(b.getByRole("button", { name: "Pause" })).toBeVisible();
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
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/reader-audiobook-${name}-${scheme}${engine()}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
});

// The book's chapter 1 ends and chapter 2 begins, with the new chapter's
// heading spoken between them, as in real audiobooks. A new chapter takes a
// moment to open, so the page turns as soon as the last word of chapter 1
// is over: by the time chapter 2's first word is spoken, it is on the page.
test("M13 (d): reading on into the book's next chapter, the page turns during the spoken heading and every word lights on time", async ({ page }) => {
  test.setTimeout(90_000);
  const bookId = await jekyllId(page);
  const { zip, expected } = readAlong([{ title: "Two chapters", said: [32, "Search for Mr. Hyde.", 33] }]);
  const imp = await importReading(page, bookId, zip(), expected);
  const bar = await openListening(page, bookId, 32);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-cfi", /^epubcfi\(\/6\/6!/);
  await recordPlayer(page);
  await bar.getByRole("button", { name: "Play" }).click();
  const first = expected.findIndex((w) => w.cfi === PARAGRAPHS[33].cfi);
  await playUntil(page, expected[first + 8].startMs + 300);
  const { frames, events } = await recording(page);
  await page.evaluate(() => document.querySelector("audio")!.pause());
  const { paragraphs } = expectEveryWordOnTime(frames, expected, { minWords: first + 8 });
  expect(paragraphs).toEqual([32, 33].map((i) => PARAGRAPHS[i].cfi));
  // The page turned to chapter 2 (spine item /6/8) during the heading: after
  // chapter 1's last word, before chapter 2's first.
  const turned = frames.find((f) => f[6].startsWith("epubcfi(/6/8!"));
  expect(turned, "the reader turned to chapter 2").toBeDefined();
  expect(turned![0] * 1000).toBeGreaterThan(expected[first - 1].startMs);
  expect(turned![0] * 1000, "turned before chapter 2's first word").toBeLessThan(expected[first].startMs);
  // And the audio was never reloaded.
  expect(events.map((e) => e[0]).filter((n) => n === "loadstart")).toHaveLength(1);
  expect(events.map((e) => e[0])).not.toContain("pause");
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
});

// Real packages have one audio file per chapter (Kuhn has 17). Crossing from
// one to the next sets the audio element's source once more and plays on
// from the "ended" event, which Safari's engine may refuse without a click.
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
  const { paragraphs } = expectEveryWordOnTime(frames, expected, { minWords: expected.length });
  expect(paragraphs).toEqual([63, 64, 65, 66].map((i) => PARAGRAPHS[i].cfi));
  // The second file was loaded once, by the same element: exactly one more start.
  const names = events.map((e) => e[0]);
  expect(names.filter((n) => n === "loadstart")).toHaveLength(2);
  expect(names).not.toContain("error");
  expect(new Set(frames.map((f) => f[5]).filter((f) => f >= 0))).toEqual(new Set([0, 1]));
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
});

// A long audiobook (a WAV of about 16 MB): every answer is at most 8 MB, and
// the browser asks for the rest. Safari's engine asks for the whole file as
// one closed range ("bytes=0-<last>"); Chromium asks "bytes=0-". Starting
// past the first 8 MB proves both keep going on capped answers.
test("M13 (d): a long audiobook plays from past its first 8 MB, each answer capped at 8 MB", async ({ page }) => {
  test.setTimeout(120_000);
  const bookId = await jekyllId(page);
  const { zip, expected, files } = readAlong([{ title: "Long", said: PARAGRAPHS.slice(40, 140).map((_, k) => 40 + k) }], "Long reading");
  expect(files["audio/01.wav"].byteLength).toBeGreaterThan(15 * 1024 * 1024);
  const imp = await importReading(page, bookId, zip(), expected);
  const answers: { asked: string; got: string }[] = [];
  page.on("response", (r) => {
    if (r.url().includes(`/readalong/${imp.id}/audio/`)) answers.push({ asked: r.request().headers().range ?? "", got: r.headers()["content-range"] ?? `whole ${r.status()}` });
  });
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
  expectEveryWordOnTime(frames, from, { minWords: second + 3 });
  // Every answer was a range of at most 8 MB; at least one asked for more and got 8 MB; one reached past the first 8 MB.
  const ranges = answers.map((a) => ({ ...a, m: /^bytes (\d+)-(\d+)\/(\d+)$/.exec(a.got) }));
  expect(ranges.length).toBeGreaterThan(0);
  for (const r of ranges) {
    expect(r.m, `answer "${r.got}" to "${r.asked}"`).not.toBeNull();
    expect(Number(r.m![2]) - Number(r.m![1]) + 1).toBeLessThanOrEqual(8 * 1024 * 1024);
  }
  expect(ranges.some((r) => Number(r.m![2]) - Number(r.m![1]) + 1 === 8 * 1024 * 1024)).toBe(true);
  expect(ranges.some((r) => Number(r.m![1]) >= 8 * 1024 * 1024)).toBe(true);
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
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
  await anon.close();
  expect((await page.request.get(url.replace(/\/0$/, "/1"))).status()).toBe(404);
  expect((await page.request.get(url.replace(imp.id, crypto.randomUUID()))).status()).toBe(404);
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
  // Removed: its audio is gone too.
  expect((await page.request.get(url)).status()).toBe(404);
});
