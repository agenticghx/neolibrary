import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
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
  // M20 Q9: its four actions sit on one line of the panel beside the book (Remove used to wrap onto a line alone).
  const actions = noted.getByRole("button", { name: /^(Go to|Edit note|Share|Remove)$/ });
  await expect(actions).toHaveCount(4);
  const tops = await actions.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size, `tops ${tops}`).toBe(1);

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
  await page.goto("/library");
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
  await page.goto("/paths/hidden-machinery");
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
  // A note on a pillar opens its Path.
  await expect(page.getByRole("region", { name: "Your notes" }).getByRole("link", { name: /Note · Semiconductors/ })).toHaveAttribute("href", "/paths/hidden-machinery");

  await page.goto("/paths/hidden-machinery");
  await semis.getByRole("button", { name: /^Remove note/ }).click();
  await expect(semis.getByText("Watch a fab tour before Fabless.")).toHaveCount(0);
  await expect(semis.getByText("Add note")).toBeVisible();
});

// M19 P3a (the site review's third finding): a note removed by mistake comes back. For ten seconds Notes offers
// Undo; after that, "Removed notes" on Your data has Bring back. Nothing is erased (ground rule 9).
test("a removed note comes back: Undo in Notes, or Bring back on Your data", async ({ page }) => {
  test.setTimeout(60_000); // four looks of Your data, each reloaded
  await openAtRuggedCountenance(page);
  const notesButton = page.getByRole("button", { name: /^Notes/ });
  const count = async () => Number(/\((\d+)\)/.exec((await notesButton.textContent()) ?? "")?.[1] ?? 0);
  const before = await count();
  await selectPhrase(page, "never lighted by a smile");
  await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Highlight in Amber" }).click();
  await expect(notesButton).toHaveText(`Notes (${before + 1})`);
  await notesButton.click();
  const list = page.getByTestId("notes");
  const item = list.locator("li").filter({ has: page.locator("blockquote", { hasText: /^never lighted by a smile$/ }) });
  await expect(item).toHaveCount(1);
  const status = page.getByRole("navigation", { name: "Notes" }).getByRole("status");

  // Undo, at once: the note is back, here and on the server.
  await item.getByRole("button", { name: "Remove" }).click();
  await expect(item).toHaveCount(0);
  await expect(status).toHaveText("Note removed. Undo");
  await expect(notesButton).toHaveText(before ? `Notes (${before})` : "Notes");
  await status.getByRole("button", { name: "Undo" }).click();
  await expect(item).toHaveCount(1);
  await expect(status).toHaveText("");
  await expect(notesButton).toHaveText(`Notes (${before + 1})`);
  await page.reload();
  await expect(reader(page)).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(notesButton).toHaveText(`Notes (${before + 1})`);

  // Removed again, then brought back from Your data.
  await notesButton.click();
  await item.getByRole("button", { name: "Remove" }).click();
  await expect(item).toHaveCount(0);
  const book = /\/books\/([0-9a-f-]{36})\/read/.exec(page.url())![1];
  const removed = (await (await page.request.get(`/api/books/${book}/annotations`)).json()).annotations.length;
  expect(removed).toBe(before);
  await page.goto("/data");
  const card = page.getByRole("region", { name: "Removed notes" });
  const row = card.getByRole("listitem").filter({ hasText: "never lighted by a smile" });
  await expect(row).toContainText("Highlight · never lighted by a smile");
  await expect(row).toContainText(/The Strange Case of Dr\. Jekyll and Mr\. Hyde · removed \d+ \w+ \d{4}/);
  await mkdir("screenshots", { recursive: true });
  for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await card.scrollIntoViewIfNeeded();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${name} ${scheme} ${v.id}: ${v.help}`)).toEqual([]);
      await page.screenshot({ path: `screenshots/data-removed-notes-${name}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await row.getByRole("button", { name: /^Bring back: Highlight, never lighted by a smile/ }).click();
  await expect(row).toHaveCount(0);
  await openAtRuggedCountenance(page);
  await expect(notesButton).toHaveText(`Notes (${before + 1})`);

  // Leave the book as the later tests expect it.
  await notesButton.click();
  await item.getByRole("button", { name: "Remove" }).click();
  await expect(notesButton).toHaveText(before ? `Notes (${before})` : "Notes");
});

// M27 Q1 (Samuel, 2026-10-19): the selected-text bar closes on a click outside it, on Escape and on Listen, as × does,
// but not with a note half-written in it; while the Read aloud bar shows, it sits above it, not over it.
test("the selected-text bar gets out of the way: a click outside, Escape, Listen", async ({ page }) => {
  await openAtRuggedCountenance(page);
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  const notesButton = page.getByRole("button", { name: /^Notes/ });
  const notesBefore = await notesButton.textContent();

  // A click on the page, inside the book's frame.
  await selectPhrase(page, "backward in sentiment");
  await expect(bar).toBeVisible();
  const point = await page.evaluate((text) => {
    const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
    for (const { doc } of view.renderer.getContents()) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue!.indexOf(text);
        if (i < 0) continue;
        const r = doc.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 4);
        const box = r.getBoundingClientRect();
        const frame = (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect();
        return { x: frame.left + box.left + box.width / 2, y: frame.top + box.top + box.height / 2 };
      }
    }
    return null;
  }, "lean, long, dusty");
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await expect(bar).toBeHidden();

  // A click outside the book (the chapter's name in the foot), then Escape.
  await selectPhrase(page, "backward in sentiment");
  await expect(bar).toBeVisible();
  await page.locator("footer").getByText("Story of the Door").click();
  await expect(bar).toBeHidden();
  await selectPhrase(page, "backward in sentiment");
  await expect(bar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();

  // A half-written note is not thrown away by a click outside; × still closes the bar.
  await selectPhrase(page, "backward in sentiment");
  await bar.getByRole("button", { name: "Add note" }).click();
  await bar.getByLabel("Your note").fill("Half a thought");
  await page.locator("footer").getByText("Story of the Door").click();
  await expect(bar.getByLabel("Your note")).toHaveValue("Half a thought");
  await bar.getByRole("button", { name: "Back" }).click();
  await bar.getByRole("button", { name: "Close" }).click();
  await expect(bar).toBeHidden();
  await expect(notesButton).toHaveText(notesBefore!);

  // Listen closes it; text selected while listening puts it above the Read aloud bar.
  await selectPhrase(page, "backward in sentiment");
  await expect(bar).toBeVisible();
  const listen = page.locator("footer").getByRole("button", { name: "Listen" });
  await listen.click();
  const readAloud = page.getByRole("region", { name: "Read aloud" });
  await expect(readAloud).toBeVisible();
  await expect(bar).toBeHidden();
  await selectPhrase(page, "backward in sentiment");
  await expect(bar).toBeVisible();
  await expect
    .poll(async () => {
      const [b, r] = [await bar.boundingBox(), await readAloud.boundingBox()];
      return b && r ? Math.round(b.y + b.height - r.y) : null;
    })
    .toBeLessThanOrEqual(0);
  // On a phone too: there the bar has a place of its own.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const [b, r] = [await bar.boundingBox(), await readAloud.boundingBox()];
      return b && r ? Math.round(b.y + b.height - r.y) : null;
    })
    .toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await listen.click();
  await expect(readAloud).toBeHidden();
  await expect(bar).toBeHidden();
});
