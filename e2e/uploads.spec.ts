import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractSections } from "../lib/library/sections";
import { readableEpub } from "../lib/library/test-epub";
import { buildPackage } from "../lib/readalong/fixture";
import { ADMIN_STATE } from "./pages";

// M3 "Done when" (part): uploading three public-domain books shows them on the
// shelf with correct titles and covers; uploading a file whose title matches a
// title waiting for it (a placeholder on a Path) attaches to it.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

const fixture = (name: string) => path.join("fixtures", "books", name);

test("three public-domain books land on the shelf with their titles and covers", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Choose files").setInputFiles([
    fixture("stevenson-jekyll-and-hyde.epub"),
    fixture("shelley-frankenstein.epub"),
    fixture("wells-the-time-machine.epub"),
  ]);
  const results = page.getByTestId("upload-results");
  await expect(results.getByText("Added to your library")).toHaveCount(3);
  // The Import page updates itself after an upload (useBookUpload's router.refresh): with no reload,
  // the new books are offered for your own audiobook (Frankenstein is new in this test).
  await expect(page.getByText("Add a book first", { exact: false })).toHaveCount(0);
  await expect(page.getByLabel("Book", { exact: true }).locator("option", { hasText: "Frankenstein, by Mary Shelley" })).toHaveCount(1);

  await page.goto("/library");
  const shelf = page.getByTestId("shelf");
  for (const title of ["The Strange Case of Dr. Jekyll and Mr. Hyde", "Frankenstein", "The Time Machine"]) {
    await expect(shelf.getByRole("link", { name: new RegExp(`^${title.replace(/[.]/g, "\\.")}`) })).toBeVisible();
  }
  // Each cover is the book's own image, and it actually loaded.
  const covers = shelf.locator("img");
  await expect(covers).toHaveCount(3);
  for (const img of await covers.all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await expect(page.getByText("3 books.")).toBeVisible();
});

test("a book page shows what the file told us", async ({ page }) => {
  await page.goto("/library");
  await page.getByTestId("shelf").getByRole("link", { name: /^The Time Machine/ }).click();
  await expect(page.getByRole("heading", { name: "The Time Machine", level: 1 })).toBeVisible();
  await expect(page.getByText("H. G. Wells")).toBeVisible();
  await expect(page.getByText(/EPUB · \d+ chapters/)).toBeVisible();
});

const GRID_TEXT = `<h1>The wires</h1>${Array.from(
  { length: 6 },
  (_, i) => `<p>Paragraph ${i + 1}. A line of poles runs along the road, carrying power from a station far away to the houses and shops of a small town, where lamps and kettles wait for it every evening.</p>`,
).join("")}`;

test("a file matching a title not available yet attaches to it and lights up the path", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Choose files").setInputFiles({
    name: "the-grid.epub",
    mimeType: "application/epub+zip",
    // Readable (spine and contents), so the stats test can open it in the reader. Invented text.
    buffer: Buffer.from(readableEpub("The Grid: The Fraying Wires Between Americans and Our Energy Future", [GRID_TEXT], "Gretchen Bakke")),
  });
  await expect(page.getByTestId("upload-results").getByText("Added to a title that was waiting for it")).toBeVisible();
  await page.goto("/paths/hidden-machinery");
  // Available now: no "(not available yet)" in its name, its label says so (an EPUB, and the
  // tests' fake voice counts as narration), and the path counts it.
  const grid = page.getByRole("link", { name: "The Grid", exact: true });
  await expect(grid).toBeVisible();
  await expect(page.getByRole("link", { name: "The Grid (not available yet)" })).toHaveCount(0);
  await expect(page.getByRole("figure").filter({ has: grid }).getByText("Read and listen", { exact: true })).toBeVisible();
  await expect(page.getByText(/\b1 available, \d+ not available yet/)).toBeVisible();
});

test("duplicates, other file types and DRM-protected books are refused politely", async ({ page }) => {
  await page.goto("/import");
  const drm = zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>'),
    "META-INF/rights.xml": strToU8("<rights/>"),
    "c.opf": strToU8("<package><metadata/></package>"),
  });
  await page.getByLabel("Choose files").setInputFiles([
    { name: "wells-the-time-machine.epub", mimeType: "application/epub+zip", buffer: readFileSync(fixture("wells-the-time-machine.epub")) },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    { name: "locked.epub", mimeType: "application/epub+zip", buffer: Buffer.from(drm) },
  ]);
  const results = page.getByTestId("upload-results");
  await expect(results.getByText("Already in your library")).toBeVisible();
  await expect(results.getByText("Only EPUB, PDF and Markdown (.md) files can be added.")).toBeVisible();
  await expect(results.getByText(/DRM-protected/)).toBeVisible();
  await page.goto("/library");
  await expect(page.getByText("4 books.")).toBeVisible();
});

test("cover links are signed, short-lived and only for their owner", async ({ page, browser }) => {
  await page.goto("/library");
  const src = await page.getByTestId("shelf").locator("img").first().getAttribute("src");
  expect(src).toMatch(/^\/api\/files\/covers\/[0-9a-f-]+\/[0-9a-f-]+\.svg\?exp=\d+&sig=/);
  const ok = await page.request.get(src!);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-security-policy"]).toContain("sandbox");
  // Tampered signature → 403; signed out → 401.
  expect((await page.request.get(src!.replace(/sig=.*/, "sig=forged"))).status()).toBe(403);
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.get(src!)).status()).toBe(401);
  await anon.close();
});

// M3 (c): finding books on the shelf.

test("search and sort the shelf", async ({ page }) => {
  await page.goto("/library");
  const shelf = page.getByTestId("shelf");
  const titles = () => shelf.locator("li").evaluateAll((els) => els.map((e) => e.querySelector("span[class*=itemTitle]")!.textContent));

  await page.getByLabel("Sort").selectOption("title");
  await expect(page).toHaveURL(/sort=title/);
  await expect.poll(titles).toEqual(["Frankenstein", "The Grid", "The Strange Case of Dr. Jekyll and Mr. Hyde", "The Time Machine"]);

  await page.getByRole("searchbox", { name: "Filter by title or author" }).fill("wells");
  await expect(page).toHaveURL(/q=wells/);
  await expect.poll(titles).toEqual(["The Time Machine"]);

  await page.getByRole("searchbox", { name: "Filter by title or author" }).fill("no such book");
  await expect(page.getByText("Nothing matches “no such book”.")).toBeVisible();
});

test("collections group books and filter the shelf", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "+ New collection" }).click();
  await page.getByLabel("Collection name").fill("Gothic");
  await page.getByRole("button", { name: "Create" }).click();
  // The library page's collection chips (the sidebar lists collections too, by name only).
  const chips = page.getByRole("navigation", { name: "Collections" });
  await expect(chips.getByRole("link", { name: "Gothic 0" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No books in this collection yet.")).toBeVisible();

  // Add two books from their pages.
  for (const title of [/^Frankenstein/, /^The Strange Case/]) {
    await page.goto("/library");
    await page.getByTestId("shelf").getByRole("link", { name: title }).click();
    const toggle = page.getByRole("button", { name: "Gothic" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }

  await page.goto("/library");
  await chips.getByRole("link", { name: "Gothic 2" }).click();
  await expect(page.getByTestId("shelf").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("shelf").getByRole("link", { name: /^The Time Machine/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete collection" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("link", { name: /^Gothic/ })).toHaveCount(0);
  await expect(page.getByText("4 books.")).toBeVisible();
});

test("old /shelf links land on /library, keeping their query", async ({ page }) => {
  await page.goto("/shelf");
  await expect(page).toHaveURL(/\/library$/);
  await page.goto("/shelf?sort=title&q=wells&c=a&c=b");
  await expect(page).toHaveURL(/\/library\?sort=title&q=wells&c=a&c=b$/);
  await expect(page.getByRole("heading", { name: "Your library", level: 1 })).toBeVisible();
});

test("the library can be downloaded, and import never overwrites", async ({ page, browser }) => {
  const res = await page.request.get("/api/export");
  expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="neolibrary-library-\d{4}-\d{2}-\d{2}\.json"/);
  const data = await res.json();
  expect(data).toMatchObject({ format: "neolibrary-library", version: 1 });
  expect(data.books.filter((b: { file: unknown }) => b.file).length).toBe(4);
  expect(data.paths[0].slug).toBe("hidden-machinery");

  // Importing into a library that is not empty is refused.
  const refused = await page.request.post("/api/import", { data });
  expect(refused.status()).toBe(409);

  // A fresh, empty account can bring a library file back.
  const admin = page;
  await admin.goto("/admin/invites");
  await admin.getByRole("button", { name: "Make an invitation link" }).click();
  const link = await admin.getByTestId("invite-link").inputValue();
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guest = await ctx.newPage();
  await guest.goto(link);
  await guest.getByLabel("Your name").fill("Grace");
  await guest.getByLabel("Email address").fill("grace@example.com");
  await guest.getByLabel("Password").fill("a long password here");
  await guest.getByRole("button", { name: "Join the library" }).click();
  await guest.waitForURL(/\/$/);

  const bookId = crypto.randomUUID();
  const small = {
    format: "neolibrary-library",
    version: 1,
    exportedAt: new Date().toISOString(),
    books: [{ id: bookId, title: "Meditations", author: "Marcus Aurelius", note: "", unverified: false, file: null, coverKey: null, language: null, publisher: null, description: null, toc: [], pageCount: null, progress: 0, lastOpenedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    paths: [],
    collections: [{ id: crypto.randomUUID(), name: "Stoics", createdAt: new Date().toISOString(), bookIds: [bookId] }],
  };
  await guest.goto("/data");
  await guest.getByLabel("Library file (.json)").setInputFiles({ name: "lib.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(small)) });
  await expect(guest.getByRole("status")).toHaveText("Brought back 1 books, 0 paths and 1 collections.");
  // The sidebar shows the imported collection without a reload.
  await expect(guest.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: "Stoics", exact: true })).toBeVisible();
  const back = await (await ctx.request.get("/api/export")).json();
  expect(back.books.map((b: { title: string }) => b.title)).toEqual(["Meditations"]);
  expect(back.collections[0]).toMatchObject({ name: "Stoics", bookIds: [bookId] });
  await ctx.close();
});

test("M14 follow-up V3a: Import is the one place to add books and your own audiobooks, and says how books are heard", async ({ page }) => {
  // The Library has no drop box any more (Samuel, #90): adding is on the Import page.
  await page.goto("/library");
  await expect(page.getByLabel("Choose files")).toHaveCount(0);
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Choose files")).toHaveAttribute("multiple", "");
  // Your own audiobook goes with a book you have: the list is exactly the library's books with a file.
  const exported = (await (await page.request.get("/api/export")).json()).books as { title: string; author: string; file: unknown }[];
  const withFile = exported.filter((b) => b.file).map((b) => (b.author ? `${b.title}, by ${b.author}` : b.title));
  const book = page.getByLabel("Book", { exact: true });
  const offered = (await book.locator("option").allTextContents()).slice(1);
  expect(offered.slice().sort()).toEqual(withFile.slice().sort());
  await book.selectOption({ label: "Frankenstein, by Mary Shelley" });
  await page.getByRole("button", { name: "Choose", exact: true }).click();
  await expect(page).toHaveURL(/\/import\?book=[0-9a-f-]+#audio-h$/);
  await expect(book.locator("option:checked")).toHaveText("Frankenstein, by Mary Shelley");
  // The same read-along upload as on the book's page, for that book: a package made from
  // Frankenstein's file is added to Frankenstein, then removed (later tests expect no audiobook on it).
  const bookId = new URL(page.url()).searchParams.get("book")!;
  const imports = async () => (await (await page.request.get(`/api/books/${bookId}/readalong`)).json()).imports as { status: string; title: string }[];
  expect(await imports()).toEqual([]);
  const bytes = new Uint8Array(readFileSync(fixture("shelley-frankenstein.epub")));
  const paragraphs = extractSections(bytes).filter((s) => s.kind === "paragraph").slice(10, 13);
  const pkg = buildPackage({
    bookBytes: bytes,
    title: "Frankenstein test reading",
    chapters: [{ title: "Letter 1", paragraphs: paragraphs.map((p) => p.text), inBook: paragraphs.map((p) => p.chapterIndex) }],
  });
  const section = page.getByRole("region", { name: "Your audiobook", exact: true });
  await section.getByLabel("or a .zip of it (up to 50 MB)").setInputFiles({ name: "frankenstein-readalong.zip", mimeType: "application/zip", buffer: Buffer.from(pkg.zip()) });
  await expect(section).toContainText("Ready · added");
  // Its heading sits one level below the section's own ("Add your audiobook to a book", an h2).
  await expect(section.getByRole("heading", { level: 3, name: "Your audiobook", exact: true })).toBeVisible();
  expect(await imports()).toMatchObject([{ status: "ready", title: "Frankenstein test reading" }]);
  // With a book chosen, the page is accessible and fits a phone in all four looks (the page
  // screenshots in pages.ts show it with no book chosen).
  mkdirSync("screenshots", { recursive: true });
  for (const [name, width, height] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The serif text at the reading size: smaller on a phone, as on the other pages.
      const lede = page.getByText("Add your books and your own audiobooks for them, or create AI voice narration for an entire EPUB, paid up front.", { exact: true });
      expect(await lede.evaluate((el) => getComputedStyle(el).fontSize)).toBe(name === "phone" ? "18px" : "20px");
      await page.screenshot({ path: `screenshots/import-audiobook-${name}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await section.getByRole("button", { name: "Remove Frankenstein test reading" }).click();
  await expect(section).not.toContainText("Ready · added");
  expect(await imports()).toEqual([]);
  // A read-along .zip dropped on the audiobook section reaches the page's book uploader (a drop
  // anywhere on the page adds books): it is not sent as a book, and the page says where it goes.
  const posted: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/books") posted.push(r.url());
  });
  const zipDrop = await page.evaluateHandle(() => {
    const t = new DataTransfer();
    t.items.add(new File(["PK"], "x-readalong.zip", { type: "application/zip" }));
    return t;
  });
  for (const type of ["dragenter", "dragover", "drop"]) await section.dispatchEvent(type, { dataTransfer: zipDrop });
  await expect(page.getByTestId("upload-results")).toContainText(
    "A .zip is not a book. If it is your own audiobook, choose its book under “Add your audiobook to a book”, then choose the .zip there.",
  );
  expect(posted).toEqual([]);
  // How books are heard: the words Samuel approved, whole and unchanged (toHaveText with strings ignores line breaks only),
  // then (V5) one sentence of its own on the whole-book choice.
  await expect(page.getByRole("region", { name: "How books are heard", exact: true }).locator("p")).toHaveText([
    "To hear a book, add its file first. Then any book, EPUB or PDF, can be read aloud paragraph by paragraph by an AI voice (paid the first time each paragraph plays, then free), or can get your own audiobook, which plays straight through for free.",
    "An AI voice can also narrate an entire EPUB in advance, paid up front, when you choose it above under “Create AI voice narration for an entire book”.",
  ]);
});

// M19 P3b (the site review's third finding): a book can leave the library, behind a confirmation, and come back
// from Your data with its notes. Uploading it again brings the same book back instead of a second copy.
test("a book can be removed from the library and brought back, with its notes", async ({ page }) => {
  test.setTimeout(60_000); // four looks of Your data, each reloaded
  const spare = Buffer.from(readableEpub("A Spare Book", ["<p>A short chapter about a lighthouse keeper.</p>"], "Ann Example"));
  const upload = async () => {
    await page.goto("/import");
    await page.getByLabel("Choose files").setInputFiles({ name: "spare.epub", mimeType: "application/epub+zip", buffer: spare });
    return page.getByTestId("upload-results");
  };
  await expect((await upload()).getByText("Added to your library")).toBeVisible();
  const shelf = page.getByTestId("shelf");
  await page.goto("/library");
  await shelf.getByRole("link", { name: /^A Spare Book/ }).click();
  await expect(page.getByRole("heading", { name: "A Spare Book", level: 1 })).toBeVisible();
  const bookUrl = page.url();
  const id = /\/books\/([0-9a-f-]{36})/.exec(bookUrl)![1];
  await page.request.post(`/api/books/${id}/annotations`, { data: { kind: "note", body: "Keep this thought about lighthouses." } });

  // Folded until asked, and confirmed before anything happens.
  const confirm = page.locator("form").getByRole("button", { name: "Remove from library" });
  await expect(confirm).toBeHidden();
  await page.locator("summary", { hasText: "Remove from library" }).click();
  await expect(page.getByText("Your notes and the file are kept, and Your data can bring it back.")).toBeVisible();
  await confirm.click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(shelf.getByRole("link", { name: /^A Spare Book/ })).toHaveCount(0);
  expect((await page.goto(bookUrl))?.status()).toBe(404);

  await page.goto("/data");
  const card = page.getByRole("region", { name: "Removed books" });
  await expect(card.getByRole("listitem").filter({ hasText: "A Spare Book" })).toContainText(/A Spare Book · Ann Example\s*removed \d+ \w+ \d{4}/);
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${name} ${scheme} ${v.id}: ${v.help}`)).toEqual([]);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `screenshots/data-removed-books-${name}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await card.getByRole("button", { name: "Bring back: A Spare Book" }).click();
  await expect(card).toHaveCount(0);
  await page.goto("/library");
  await expect(shelf.getByRole("link", { name: /^A Spare Book/ })).toHaveCount(1);
  await page.goto(bookUrl);
  await expect(page.getByRole("region", { name: "Your notes" })).toContainText("1 notes on the book");

  // Removed again, then uploaded again: the same book comes back, notes and all; no second copy.
  await page.locator("summary", { hasText: "Remove from library" }).click();
  await confirm.click();
  await expect(page).toHaveURL(/\/library$/);
  await expect((await upload()).getByText("You had removed this book: it is back, with your notes")).toBeVisible();
  await page.goto("/library");
  await expect(shelf.getByRole("link", { name: /^A Spare Book/ })).toHaveCount(1);
  await page.goto(bookUrl);
  await expect(page.getByRole("region", { name: "Your notes" })).toContainText("1 notes on the book");

  // Leave the shelves as the later tests expect them: the spare book removed (kept, out of every list).
  await page.locator("summary", { hasText: "Remove from library" }).click();
  await confirm.click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(shelf.getByRole("link", { name: /^A Spare Book/ })).toHaveCount(0);
});

// M29 "Done when": a Markdown (.md) book is added on the Import page and opens in the reader as a book with chapters
// (its parts and chapters in Contents; italics and the rest are checked in lib/library/markdown-epub.test.ts); a script with the reader's token can add one too
// (POST /api/agent/books). Both are removed again at the end, so the later tests find the shelves as before.
test("a Markdown book is added like an EPUB, opens with its chapters, and an agent can add one", async ({ page, playwright }) => {
  test.setTimeout(90_000);
  const md = [
    "---",
    "title: The Lamp Book",
    "author: Ann Example",
    "---",
    "# Part I: LIGHT",
    "",
    "## Chapter 1: The First Lamp",
    "",
    "The first lamp burned oil, and _The Lamp Gazette_ said it was smoky. A keeper trimmed the wick each night.",
    "",
    "## Chapter 2: The Second Lamp",
    "",
    "The second lamp burned gas, brighter and cleaner, and the keeper slept a little longer.",
  ].join("\n");
  await page.goto("/import");
  await expect(page.getByText("EPUB, PDF or Markdown (.md) files, free of DRM (copy protection).")).toBeVisible();
  await page.getByLabel("Choose files").setInputFiles({ name: "the-lamp-book.md", mimeType: "text/markdown", buffer: Buffer.from(md) });
  await expect(page.getByTestId("upload-results").getByText("Added to your library")).toBeVisible();

  const shelf = page.getByTestId("shelf");
  await page.goto("/library");
  await shelf.getByRole("link", { name: /^The Lamp Book/ }).click();
  await expect(page.getByRole("heading", { name: "The Lamp Book", level: 1 })).toBeVisible();
  await expect(page.getByText("Ann Example").first()).toBeVisible();
  const bookUrl = page.url();
  const id = /\/books\/([0-9a-f-]{36})/.exec(bookUrl)![1];

  // In the reader: an EPUB with the parts and chapters in Contents, and its text searchable.
  await page.goto(`/books/${id}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const { hits } = await (await page.request.get(`/api/books/${id}/search?q=${encodeURIComponent("keeper trimmed wick")}`)).json();
  expect(hits.length).toBe(1);
  await page.getByRole("button", { name: "Contents" }).click();
  for (const name of ["Part I: LIGHT", "Chapter 1: The First Lamp", "Chapter 2: The Second Lamp"]) await expect(page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true })).first()).toBeVisible();

  // An agent with the reader's token adds a Markdown book.
  await page.goto("/agents");
  await page.getByLabel("Which agent is it for?").fill("Markdown script");
  await page.getByRole("button", { name: "Make a token" }).click();
  const token = await page.getByTestId("new-token").inputValue();
  const agent = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  const sent = await agent.post("/api/agent/books", {
    multipart: { file: { name: "a-second-lamp.md", mimeType: "text/markdown", buffer: Buffer.from("# A Second Lamp\n\nOne short chapter about a lamp on a hill.") } },
  });
  expect(sent.status()).toBe(201);
  const second = (await sent.json()) as { status: string; bookId: string; title: string };
  expect(second).toMatchObject({ status: "added", title: "A Second Lamp" });
  expect((await agent.post("/api/agent/books", { multipart: { file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } } })).status()).toBe(400);
  expect((await agent.post("/api/agent/books", { multipart: { note: "no file" } })).status()).toBe(400);
  await agent.dispose();
  expect((await (await page.request.get("/api/export")).json()).books.find((b: { id: string }) => b.id === second.bookId)).toMatchObject({ title: "A Second Lamp" });

  // Leave the shelves as the later tests expect them: both removed (kept, out of every list).
  for (const url of [bookUrl, `/books/${second.bookId}`]) {
    await page.goto(url);
    await page.locator("summary", { hasText: "Remove from library" }).click();
    await page.locator("form").getByRole("button", { name: "Remove from library" }).click();
    await expect(page).toHaveURL(/\/library$/);
  }
  await expect(shelf.getByRole("link", { name: /Lamp/ })).toHaveCount(0);
});

// M30 "Done when": a Google Drive link to a shared folder adds its books like uploads, says which files were skipped,
// and explains a link that is not shared. The server's Drive is the fake one here (DRIVE_FAKE=1, lib/drive/fake.ts).
// Both books are removed at the end, so the later tests find the shelves as before.
test("books are added from a Google Drive link to a shared folder; other files are skipped", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/import");
  const linkBox = page.getByLabel(/Or add from Google Drive/);
  const add = page.getByRole("button", { name: "Add from Drive" });
  await expect(add).toBeDisabled();
  await linkBox.fill("https://drive.google.com/drive/folders/1FakeDrivePrivateForTests00?usp=sharing");
  await add.click();
  await expect(page.getByRole("alert").filter({ hasText: "Anyone with the link" })).toBeVisible();

  await linkBox.fill("https://drive.google.com/drive/folders/1FakeDriveFolderForTests00?usp=sharing");
  await add.click();
  const results = page.getByTestId("upload-results");
  await expect(results.getByRole("listitem")).toHaveCount(3);
  await expect(results.getByRole("listitem").filter({ hasText: "A Book From Drive" })).toContainText("Added to your library");
  await expect(results.getByRole("listitem").filter({ hasText: "Drive Notes" })).toContainText("Added to your library");
  await expect(results.getByRole("listitem").filter({ hasText: "shopping-list.txt" })).toContainText("Skipped: not an EPUB, PDF or Markdown file.");
  await expect(linkBox).toHaveValue("");

  // Screenshots of the Import page with the results (phone and desktop, light and dark).
  mkdirSync("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.map((v) => `${name} ${scheme} ${v.id}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/import-drive-${name}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });

  // Leave the shelves as the later tests expect them: both removed.
  const shelf = page.getByTestId("shelf");
  for (const title of ["A Book From Drive", "Drive Notes"]) {
    await page.goto("/library");
    await shelf.getByRole("link", { name: new RegExp(`^${title}`) }).click();
    await page.locator("summary", { hasText: "Remove from library" }).click();
    await page.locator("form").getByRole("button", { name: "Remove from library" }).click();
    await expect(page).toHaveURL(/\/library$/);
  }
  await expect(shelf.getByRole("link", { name: /Drive/ })).toHaveCount(0);
});

// M31 "Done when": a PDF with text of its own offers "Flowing text from this PDF" on its page; making it gives a
// flowing edition (no AI) that opens in the reader with Scan | Text, chapter by chapter. The book is removed at the
// end, so the later tests find the shelves as before.
test("a PDF with text of its own is laid out again as flowing text, without AI", async ({ page }) => {
  test.setTimeout(90_000);
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const roman = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const words = "The keeper climbed the tower at dusk and lit the great lamp, and ships far out at sea could see it shine across the water all night long.";
  for (const [n, heading] of [[1, "I. The Tower"], [2, null], [3, "II. The Ships"]] as const) {
    const p = pdf.addPage([612, 792]);
    p.drawText("A Lighthouse Book", { x: 72, y: 740, size: 11, font: italic });
    p.drawText(String(n), { x: 300, y: 40, size: 11, font: roman });
    let y = 680;
    if (heading) {
      p.drawText(heading, { x: 72, y, size: 14, font: bold });
      y -= 40;
    }
    for (let k = 0; k < 6; k++, y -= 16) p.drawText(k % 3 === 0 ? `   ${words.slice(0, 80)}` : words.slice(0, 80), { x: k % 3 === 0 ? 90 : 72, y, size: 12, font: roman });
  }
  const upload = await page.request.post("/api/books", {
    multipart: { files: { name: "a-lighthouse-book.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) } },
  });
  const bookId = (await upload.json()).results[0].bookId as string;

  await page.goto(`/books/${bookId}`);
  const panel = page.getByTestId("pdf-text-edition");
  await expect(panel.getByRole("heading", { name: "Flowing text from this PDF" })).toBeVisible();
  await expect(panel).toContainText("No AI is used and nothing is spent");
  await panel.getByRole("button", { name: "Make the flowing text" }).click();
  await expect(page.getByTestId("pdf-text-edition-status")).toHaveText("Made from 3 of 3 pages.");
  await expect(panel.getByRole("button", { name: "Make it again" })).toBeVisible();

  mkdirSync("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.mouse.move(0, 0); // no hover state in the check or the screenshot (as fourLooks in review.spec.ts)
      await page.waitForTimeout(300); // the Read button's colours ease into the new theme (as agents.spec.ts waits)
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.map((v) => `${name} ${scheme} ${v.id}: ${v.nodes.map((n) => `${n.target} ${n.failureSummary}`).join("; ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `screenshots/pdf-text-edition-${name}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });

  // The flowing text opens in the reader, chapter by chapter, with Scan | Text.
  await panel.getByRole("link", { name: "Read the flowing text" }).click();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Scan" }).or(page.getByRole("link", { name: "Scan" })).first()).toBeVisible();
  await page.getByRole("button", { name: "Contents" }).click();
  for (const name of ["About this edition", "I. The Tower", "II. The Ships"]) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

  // Leave the shelves as the later tests expect them: the book removed.
  await page.goto(`/books/${bookId}`);
  await page.locator("summary", { hasText: "Remove from library" }).click();
  await page.locator("form").getByRole("button", { name: "Remove from library" }).click();
  await expect(page).toHaveURL(/\/library$/);
});
