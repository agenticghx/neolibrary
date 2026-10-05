import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readableEpub } from "../lib/library/test-epub";
import { ADMIN_STATE } from "./pages";

// M3 "Done when" (part): uploading three public-domain books shows them on the
// shelf with correct titles and covers; uploading a file whose title matches a
// title waiting for it (a placeholder on a Path) attaches to it.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

const fixture = (name: string) => path.join("fixtures", "books", name);

test("three public-domain books land on the shelf with their titles and covers", async ({ page }) => {
  await page.goto("/shelf");
  await page.getByLabel("Choose files").setInputFiles([
    fixture("stevenson-jekyll-and-hyde.epub"),
    fixture("shelley-frankenstein.epub"),
    fixture("wells-the-time-machine.epub"),
  ]);
  const results = page.getByTestId("upload-results");
  await expect(results.getByText("Added to your shelf")).toHaveCount(3);

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
  await page.goto("/shelf");
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
  await page.goto("/shelf");
  await page.getByLabel("Choose files").setInputFiles({
    name: "the-grid.epub",
    mimeType: "application/epub+zip",
    // Readable (spine and contents), so the stats test can open it in the reader. Invented text.
    buffer: Buffer.from(readableEpub("The Grid: The Fraying Wires Between Americans and Our Energy Future", [GRID_TEXT], "Gretchen Bakke")),
  });
  await expect(page.getByTestId("upload-results").getByText("Added to a title that was waiting for it")).toBeVisible();
  await page.goto("/");
  // Available now: no "(not available yet)" in its name, its label says so (an EPUB, and the
  // tests' fake voice counts as narration), and the path counts it.
  const grid = page.getByRole("link", { name: "The Grid", exact: true });
  await expect(grid).toBeVisible();
  await expect(page.getByRole("link", { name: "The Grid (not available yet)" })).toHaveCount(0);
  await expect(page.getByRole("figure").filter({ has: grid }).getByText("Read and listen", { exact: true })).toBeVisible();
  await expect(page.getByText(/\b1 available, \d+ not available yet/)).toBeVisible();
});

test("duplicates, other file types and DRM-protected books are refused politely", async ({ page }) => {
  await page.goto("/shelf");
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
  await expect(results.getByText("Already on your shelf")).toBeVisible();
  await expect(results.getByText("Only EPUB and PDF files can be added.")).toBeVisible();
  await expect(results.getByText(/DRM-protected/)).toBeVisible();
  await expect(page.getByText("4 books.")).toBeVisible();
});

test("cover links are signed, short-lived and only for their owner", async ({ page, browser }) => {
  await page.goto("/shelf");
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
  await page.goto("/shelf");
  const shelf = page.getByTestId("shelf");
  const titles = () => shelf.locator("li").evaluateAll((els) => els.map((e) => e.querySelector("span[class*=itemTitle]")!.textContent));

  await page.getByLabel("Sort").selectOption("title");
  await expect(page).toHaveURL(/sort=title/);
  await expect.poll(titles).toEqual(["Frankenstein", "The Grid", "The Strange Case of Dr. Jekyll and Mr. Hyde", "The Time Machine"]);

  await page.getByRole("searchbox", { name: "Search your shelf" }).fill("wells");
  await expect(page).toHaveURL(/q=wells/);
  await expect.poll(titles).toEqual(["The Time Machine"]);

  await page.getByRole("searchbox", { name: "Search your shelf" }).fill("no such book");
  await expect(page.getByText("Nothing matches “no such book”.")).toBeVisible();
});

test("collections group books and filter the shelf", async ({ page }) => {
  await page.goto("/shelf");
  await page.getByRole("button", { name: "+ New collection" }).click();
  await page.getByLabel("Collection name").fill("Gothic");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name: "Gothic 0" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No books in this collection yet.")).toBeVisible();

  // Add two books from their pages.
  for (const title of [/^Frankenstein/, /^The Strange Case/]) {
    await page.goto("/shelf");
    await page.getByTestId("shelf").getByRole("link", { name: title }).click();
    const toggle = page.getByRole("button", { name: "Gothic" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }

  await page.goto("/shelf");
  await page.getByRole("link", { name: "Gothic 2" }).click();
  await expect(page.getByTestId("shelf").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("shelf").getByRole("link", { name: /^The Time Machine/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete collection" }).click();
  await expect(page).toHaveURL(/\/shelf$/);
  await expect(page.getByRole("link", { name: /^Gothic/ })).toHaveCount(0);
  await expect(page.getByText("4 books.")).toBeVisible();
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
  const back = await (await ctx.request.get("/api/export")).json();
  expect(back.books.map((b: { title: string }) => b.title)).toEqual(["Meditations"]);
  expect(back.collections[0]).toMatchObject({ name: "Stoics", bookIds: [bookId] });
  await ctx.close();
});
