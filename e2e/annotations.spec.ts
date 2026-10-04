import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M5 "Done when" (part): Playwright makes a highlight + note, reloads, and finds both.

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial" });

const reader = (page: Page) => page.getByTestId("reader");

/** Selects a phrase in the book page currently loaded in the reader, like a reader dragging over it. */
async function selectPhrase(page: Page, phrase: string) {
  await page.evaluate((phrase) => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue!.indexOf(phrase);
        if (i < 0) continue;
        const r = doc.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + phrase.length);
        const sel = doc.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
    }
    throw new Error(`phrase not on this page: ${phrase}`);
  }, phrase);
}

async function openAtRuggedCountenance(page: Page) {
  await page.goto(`/search?q=${encodeURIComponent('"rugged countenance"')}`);
  // The book's passage (your own highlight of it is listed under "Your notes" too).
  await page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "rugged" }).click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
}

test("highlight, highlight with a note, and a bookmark survive a reload", async ({ page }) => {
  await openAtRuggedCountenance(page);
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes");

  await selectPhrase(page, "rugged countenance");
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  await expect(bar).toContainText("“rugged countenance”");
  await bar.getByRole("button", { name: "Highlight in Amber" }).click();
  // Select the next passage straight away, while the first is still saving:
  // the new selection must survive.
  await selectPhrase(page, "cold, scanty and embarrassed in discourse");
  await expect(bar).toContainText("“cold, scanty and embarrassed in discourse”");
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes (1)");
  await expect(bar).toContainText("“cold, scanty and embarrassed in discourse”");
  await bar.getByRole("button", { name: "Add note" }).click();
  await bar.getByLabel("Your note").fill("Reticence as character.");
  await bar.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes (2)");

  await page.getByRole("button", { name: "Bookmark this page" }).click();
  await expect(page.getByRole("button", { name: "Remove bookmark" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes (3)");

  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes (3)");
  await expect(page.getByRole("button", { name: "Remove bookmark" })).toBeVisible();
  await page.getByRole("button", { name: /^Notes/ }).click();
  const list = page.getByTestId("notes");
  await expect(list.locator("li")).toHaveCount(3);
  // Reading order: the bookmark (top of the page), then the two passages.
  await expect(list.locator("li").nth(0)).toContainText("Bookmark");
  await expect(list.locator("li").nth(1)).toContainText("rugged countenance");
  await expect(list.locator("li").nth(2)).toContainText("cold, scanty and embarrassed in discourse");
  await expect(list.locator("li").nth(2)).toContainText("Reticence as character.");
});

test("editing keeps every version; removing hides; book notes work", async ({ page }) => {
  await openAtRuggedCountenance(page);
  await page.getByRole("button", { name: /^Notes/ }).click();
  const list = page.getByTestId("notes");
  // The third item (bookmark, highlight, highlight-with-note); found by position
  // because its text moves into the edit box while editing.
  const noted = list.locator("li").nth(2);
  await expect(noted).toContainText("Reticence as character.");
  await noted.getByRole("button", { name: "Edit note" }).click();
  await noted.getByLabel("Edit note").fill("Reticence as character, not coldness.");
  await noted.getByRole("button", { name: "Save" }).click();
  await expect(list.getByText("Reticence as character, not coldness.")).toBeVisible();

  const all = (await (await page.request.get(`/api/books/${await bookId(page)}/annotations`)).json()).annotations;
  const edited = all.find((a: { body: string }) => a.body.startsWith("Reticence"));
  const versions = (await (await page.request.get(`/api/annotations/${edited.id}`)).json()).versions;
  expect(versions.map((v: { body: string }) => v.body)).toEqual(["Reticence as character.", "Reticence as character, not coldness."]);

  // The amber highlight is second (the bookmark's excerpt also contains the phrase).
  await expect(list.locator("li").nth(1).locator("blockquote")).toHaveText("rugged countenance");
  await list.locator("li").nth(1).getByRole("button", { name: "Remove" }).click();
  await expect(list.locator("li")).toHaveCount(2);

  await page.getByLabel("A note about this book").fill("Compare with Frankenstein: the double.");
  await page.getByRole("button", { name: "Add note", exact: true }).first().click();
  await expect(list.locator("li").first()).toContainText("Note on the book");
  await expect(list.locator("li").first()).toContainText("Compare with Frankenstein: the double.");
  await expect(page.getByRole("button", { name: /^Notes/ })).toHaveText("Notes (3)");
});

async function bookId(page: Page) {
  return /\/books\/([0-9a-f-]{36})\/read/.exec(page.url())![1];
}

// M5 "Done when" (part): export produces a Markdown file containing them.
test("export notes as Markdown and W3C JSON; importing the same file adds nothing", async ({ page }) => {
  await page.goto("/shelf");
  await page.getByTestId("shelf").getByRole("link", { name: /^The Strange Case/ }).click();
  const notes = page.getByRole("region", { name: "Your notes" });
  await expect(notes).toContainText("1 highlights · 1 notes on the book · 1 bookmarks");

  const download = page.waitForEvent("download");
  await notes.getByRole("link", { name: "Markdown" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("the-strange-case-of-dr-jekyll-and-mr-hyde-notes.md");
  const md = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
  expect(md).toContain("# The Strange Case of Dr. Jekyll and Mr. Hyde");
  expect(md).toContain("## Notes on the book\n\nCompare with Frankenstein: the double.");
  expect(md).toContain("## Story of the Door");
  expect(md).toContain("> cold, scanty and embarrassed in discourse\n\nReticence as character, not coldness.");
  expect(md).toContain("- Bookmark: ");

  const bookId = /\/books\/([0-9a-f-]{36})/.exec(page.url())![1];
  const w3c = await (await page.request.get(`/api/books/${bookId}/annotations/export?format=w3c`)).json();
  expect(w3c).toMatchObject({ "@context": "http://www.w3.org/ns/anno.jsonld", type: "AnnotationCollection", total: 3 });
  await notes.getByLabel("Import W3C annotations (.json)").setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(w3c)),
  });
  await expect(notes.getByRole("status")).toHaveText("Added 0 annotations; 3 already here.");
});

test("search finds your notes and opens them", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("reticence")}`);
  await expect(page.getByRole("status")).toHaveText("1 in your notes.");
  const mine = page.getByRole("region", { name: "Your notes" });
  await expect(mine.locator("mark")).toHaveText(["Reticence"]);
  await mine.getByRole("link").first().click();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
});

// M5 (c): share a passage; notes on pillars and the path.
test.describe("sharing", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("share a passage as a link or an image card", async ({ page }) => {
    await openAtRuggedCountenance(page);
    await selectPhrase(page, "dreary and yet somehow lovable");
    const bar = page.getByRole("toolbar", { name: "Selected text" });
    await bar.getByRole("button", { name: "Share" }).click();
    await bar.getByRole("button", { name: "Copy link" }).click();
    await expect(bar.getByRole("status")).toHaveText("Link copied");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/books\/[0-9a-f-]{36}\/read\?at=epubcfi/);

    const download = page.waitForEvent("download");
    await bar.getByRole("button", { name: "Image card" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("the-strange-case-of-dr-jekyll-and-mr-hyde-quote.png");
    const bytes = await (await import("node:fs/promises")).readFile((await file.path())!);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG
    expect(bytes.length).toBeGreaterThan(20_000);

    // The shared link opens the reader at that passage.
    await page.goto(link);
    await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    await expect(page.locator("footer").getByText("Story of the Door")).toBeVisible();
  });
});

test("notes on a pillar and on the whole path", async ({ page }) => {
  await page.goto("/");
  const semis = page.getByTestId("pillar").filter({ has: page.getByRole("heading", { name: "Semiconductors" }) });
  await semis.getByText("Add note").click();
  await semis.getByLabel("Note on Semiconductors").fill("Watch a fab tour before Fabless.");
  await semis.getByRole("button", { name: "Save note" }).click();
  await expect(semis.getByText("Notes (1)")).toBeVisible();
  await expect(semis.getByText("Watch a fab tour before Fabless.")).toBeVisible();

  await page.locator("header").getByText("Add note").click();
  await page.getByLabel("Note on Hidden Machinery").fill("One pillar a month.");
  await page.locator("header").getByRole("button", { name: "Save note" }).click();
  await expect(page.locator("header").getByText("One pillar a month.")).toBeVisible();

  await page.reload();
  await expect(semis.getByText("Watch a fab tour before Fabless.")).toBeVisible();
  await expect(page.locator("header").getByText("One pillar a month.")).toBeVisible();

  await page.goto(`/search?q=${encodeURIComponent("fab tour")}`);
  await expect(page.getByRole("region", { name: "Your notes" })).toContainText("Note · Semiconductors");

  await page.goto("/");
  await semis.getByRole("button", { name: /^Remove note/ }).click();
  await expect(semis.getByText("Watch a fab tour before Fabless.")).toHaveCount(0);
  await expect(semis.getByText("Add note")).toBeVisible();
});
