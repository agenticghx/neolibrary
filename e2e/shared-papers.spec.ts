import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M41 R3c (Samuel, 2026-11-02: "yes people invited should see papers"): a paper the owner marks is in every invited
// reader's library, under Papers, to read with their own notes; the owner can stop sharing it. The paper is invented,
// and removed again at the end, so the later projects find the shelves as before.
test.use({ storageState: ADMIN_STATE });

async function newReader(page: Page, browser: Browser) {
  await page.goto("/admin/invites");
  await page.getByLabel(/Who is it for/).fill("Ama, shared papers");
  await page.getByRole("button", { name: "Make an invitation link" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  // Its own address: joining counts against the sign-in limit per address (see own-keys.spec.ts).
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.41" },
  });
  const reader = await ctx.newPage();
  await reader.goto(link);
  await reader.getByLabel("Your name").fill("Ama Reader");
  await reader.getByLabel("Email address").fill(`papers-${crypto.randomUUID()}@example.com`);
  await reader.getByLabel("Password").fill("papers for everyone please");
  await reader.getByRole("button", { name: "Join the library" }).click();
  await expect(reader.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  return reader;
}

test("a paper the owner marks is in an invited reader's library to read, and leaves it when sharing stops", async ({ page, browser }) => {
  test.setTimeout(120_000);
  // The reader joins first; the paper is marked after, so marking shares it with readers already here.
  const reader = await newReader(page, browser);

  const md = ["---", "title: shared_lamplight_preprint", "---", "# Results", "", "Small print is read faster under a warm lamp."].join("\n");
  await page.goto("/import");
  await page.getByLabel("Choose files").setInputFiles({ name: "shared_lamplight_preprint.md", mimeType: "text/markdown", buffer: Buffer.from(md) });
  await expect(page.getByTestId("upload-results")).toContainText("Added to your library");
  await page.goto("/library");
  await page.getByTestId("shelf").getByRole("link", { name: /^shared_lamplight_preprint/ }).click();
  await page.waitForURL(/\/books\/[0-9a-f-]{36}$/);
  const ownerBook = page.url();
  await page.getByText("Is this a research paper?").click();
  await page.getByLabel("Its DOI or PubMed ID").fill("10.5555/12345678");
  await page.getByRole("button", { name: "Find its details" }).click();
  const title = "Lamplight and the reading of small print";
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  // Every invited reader has it (earlier projects invite readers of their own too, so the count is theirs and ours).
  await expect(page.getByTestId("paper-sharing")).toContainText(/Shared with the people you invite: \d+ readers? ha(s|ve) it in their library/);

  // The reader finds it under Papers, says who shared it, and reads it.
  await reader.goto("/library?show=papers");
  const card = reader.getByTestId("shelf").getByRole("link", { name: new RegExp(`^${title}`) });
  await expect(card).toHaveCount(1);
  await card.click();
  await expect(reader.getByTestId("paper-shared-by")).toContainText("Shared with you by");
  await expect(reader.getByRole("button", { name: "This is not a paper" })).toHaveCount(0);
  await reader.getByRole("link", { name: "Read", exact: true }).click();
  await expect(reader.getByTestId("reader")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect
    .poll(() =>
      reader.evaluate(() => {
        const view = document.querySelector("foliate-view") as unknown as { renderer: { getContents(): { doc: Document }[] } };
        return view.renderer.getContents()[0]?.doc.body.textContent ?? "";
      }),
    )
    .toContain("Small print is read faster under a warm lamp.");

  // The owner stops sharing: it leaves the reader's library, and its file is refused to them.
  await page.goto(ownerBook);
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await expect(page.getByTestId("paper-sharing")).toContainText("Not shared: only you see it.");
  await reader.goto("/library?show=papers");
  await expect(reader.getByTestId("shelf").getByRole("link", { name: new RegExp(`^${title}`) })).toHaveCount(0);

  // Leave the shelves as the later projects expect them.
  await page.goto(ownerBook);
  await page.locator("summary", { hasText: "Remove from library" }).click();
  await page.locator("form").getByRole("button", { name: "Remove from library" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await reader.context().close();
});
