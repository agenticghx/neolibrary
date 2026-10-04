import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { extractSections } from "@/lib/library/sections";
import { buildPackage } from "@/lib/readalong/fixture";
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
  await expect(section).toContainText("comes in the next update of the app");
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

  // A PDF book says its player comes after the EPUB one.
  const pdf = books.find((b) => b.title === "Discourse on the Method")!;
  await page.goto(`/books/${pdf.id}`);
  await expect(page.getByRole("region", { name: "Your audiobook" })).toContainText("PDF books come after EPUB books");
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
