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
  await expect(results.getByText("Only EPUB and PDF files can be added.")).toBeVisible();
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
      const lede = page.getByText("Add your books, and your own audiobooks for them.", { exact: true });
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
    "To hear a book, add its file first. Then an EPUB can be read aloud paragraph by paragraph by an AI voice (paid the first time each paragraph plays, then free), or any book, EPUB or PDF, can get your own audiobook, which plays straight through for free.",
    "An AI voice can also narrate an entire EPUB in advance, paid up front, when you choose it above under “Create AI voice narration for an entire book”.",
  ]);
});
