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
  await page.getByRole("link").filter({ hasText: "rugged" }).click();
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
