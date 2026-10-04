import { expect, test, type Page } from "@playwright/test";
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
