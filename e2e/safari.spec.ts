import { expect, test, type Page } from "@playwright/test";
import { expectHighlightKeepsUp } from "./listen";
import { ADMIN_STATE } from "./pages";

// The reader in Safari's engine (WebKit). On 2026-10-04 books never opened in
// Safari: the security policy's frame-ancestors 'none' made WebKit refuse the
// reader's own chapter frames, while Chrome (every other test) was fine.

test.use({ storageState: ADMIN_STATE });

const bookId = async (page: Page, title: string) =>
  ((await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[]).find((b) => b.title === title)!.id;

test("an EPUB opens in Safari, shows its text and turns pages", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|frame-ancestors/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`/books/${await bookId(page, "Frankenstein")}/read`);
  const reader = page.getByTestId("reader");
  await expect(reader).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const text = () =>
    page.evaluate(() => {
      const view = document.querySelector("foliate-view") as unknown as { lastLocation: { range: Range | null } | null };
      return view.lastLocation?.range?.toString().trim() ?? "";
    });
  await expect.poll(text).not.toBe("");
  const cfi = await reader.getAttribute("data-cfi");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(reader).not.toHaveAttribute("data-cfi", cfi ?? "");
  expect(errors).toEqual([]);
});

test("a PDF opens in Safari", async ({ page }) => {
  await page.goto(`/books/${await bookId(page, "Discourse on the Method")}/read`);
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
});

// Samuel (2026-10-04, in Safari): the read-aloud highlight did not keep up
// with the voice. Chapter V of Frankenstein, the paragraph he was listening to.
test("in Safari, the read-aloud highlight lands on every word in order, on time", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent('"instruments of life around me"')}`);
  await page.getByRole("region", { name: /Frankenstein/ }).getByRole("link").filter({ hasText: "instruments" }).first().click();
  await expect(page.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await page.getByRole("button", { name: "Listen" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar.getByRole("button", { name: "Play" })).toBeEnabled();
  await expectHighlightKeepsUp(page, "It was on a dreary night of November, that I beheld the accomplishment of my toils. With an anxiety that almost amounted to agony,");
});
