import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M14 step 5 "Done when": Samuel can make "Philosophy of science" with Kuhn
// and two titles not available yet, in order; reorder them; add Kuhn's book
// file to its title. Runs after the home project (it adds a book file).

test.use({ storageState: ADMIN_STATE });

const section = (page: Page, name: string) => page.getByTestId("edit-section").filter({ has: page.getByRole("heading", { level: 2, name }) });
const titlesIn = (page: Page, name: string) => section(page, name).locator("li [class*=name]").allTextContents();

test("make a Path of sections and titles, reorder them, and add a book file to a title waiting for it", async ({ page }) => {
  await page.goto("/paths/new");
  await page.getByLabel("Name").fill("Philosophy of science");
  await page.getByLabel("What it is for (optional)").fill("How science changes its mind.");
  await page.getByRole("button", { name: "Make the path" }).click();
  await expect(page).toHaveURL(/\/paths\/philosophy-of-science\/edit$/);
  // The sidebar lists it at once.
  await expect(page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: /^Philosophy of science/ })).toBeVisible();

  const addSection = async (name: string) => {
    await page.getByLabel("New section").fill(name);
    await page.getByRole("button", { name: "Add section" }).click();
    await expect(section(page, name)).toBeVisible();
  };
  const addNew = async (sectionName: string, title: string, author: string, kind: string) => {
    const form = section(page, sectionName).getByRole("form", { name: `Add a new title to ${sectionName}` });
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Author").fill(author);
    await form.getByLabel("Kind").selectOption({ label: kind });
    await form.getByRole("button", { name: "Add" }).click();
    await expect(section(page, sectionName).locator("li [class*=name]").getByText(title, { exact: true })).toBeVisible();
  };

  await addSection("Revolutions");
  await addNew("Revolutions", "The Structure of Scientific Revolutions", "Thomas S. Kuhn", "Story first");
  await addNew("Revolutions", "Against Method", "Paul Feyerabend", "Go deeper");
  await addSection("Fiction about science");
  const fromLibrary = section(page, "Fiction about science").getByRole("form", { name: "Add a book from your library to Fiction about science" });
  await fromLibrary.getByLabel("From your library").selectOption({ label: "Frankenstein" });
  await fromLibrary.getByRole("button", { name: "Add" }).click();
  await expect(section(page, "Fiction about science").locator("li [class*=name]").getByText("Frankenstein", { exact: true })).toBeVisible();

  // Reorder: the first cannot move up; moving the second up swaps them, and the order sticks.
  const revolutions = section(page, "Revolutions");
  await expect(revolutions.getByRole("button", { name: "Move up The Structure of Scientific Revolutions" })).toBeDisabled();
  await revolutions.getByRole("button", { name: "Move up Against Method" }).click();
  await expect.poll(() => titlesIn(page, "Revolutions")).toEqual(["Against Method", "The Structure of Scientific Revolutions"]);
  await page.reload();
  expect(await titlesIn(page, "Revolutions")).toEqual(["Against Method", "The Structure of Scientific Revolutions"]);
  await revolutions.getByRole("button", { name: "Move down Against Method" }).click();
  await expect.poll(() => titlesIn(page, "Revolutions")).toEqual(["The Structure of Scientific Revolutions", "Against Method"]);

  // The edit page passes the accessibility checks.
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

  // The Path page: sections, titles labelled, and nothing of the reading list's own words.
  await page.getByRole("link", { name: "See the path" }).click();
  await expect(page).toHaveURL(/\/paths\/philosophy-of-science$/);
  await expect(page.getByText("2 sections · 1 available, 2 not available yet")).toBeVisible();
  await expect(page.getByText("The eighteen systems")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit path" })).toHaveAttribute("href", "/paths/philosophy-of-science/edit");

  // Kuhn's book file arrives: it goes to the title waiting for it, whatever the file's own title.
  await page.getByRole("link", { name: "The Structure of Scientific Revolutions (not available yet)" }).click();
  await expect(page.getByText("Not available yet. Add the book file (EPUB or PDF) and it attaches here.")).toBeVisible();
  await page.getByLabel("Choose the book file").setInputFiles({
    name: "kuhn.pdf",
    mimeType: "application/pdf",
    buffer: readFileSync("fixtures/books/descartes-meditation-one.pdf"),
  });
  // The page refreshes with the file in place: a Read button, and the title (the list's, not the file's) Read only.
  await expect(page.getByRole("link", { name: "Read", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The Structure of Scientific Revolutions");
  await expect(page.getByText("Read only · 0% read")).toBeVisible(); // a PDF: narration is EPUB only
  await expect(page.getByLabel("Choose the book file")).toHaveCount(0);

  await page.goto("/paths/philosophy-of-science");
  await expect(page.getByRole("link", { name: "The Structure of Scientific Revolutions", exact: true })).toBeVisible();
  await expect(page.getByText("2 sections · 2 available, 1 not available yet")).toBeVisible();

  // /paths lists it; removing a title takes it off the Path, not out of the library.
  await page.goto("/paths");
  await expect(page.getByRole("main").getByRole("link", { name: "Philosophy of science", exact: true })).toBeVisible();
  await page.goto("/paths/philosophy-of-science/edit");
  await section(page, "Revolutions").getByRole("button", { name: "Remove Against Method" }).click();
  await expect.poll(() => titlesIn(page, "Revolutions")).toEqual(["The Structure of Scientific Revolutions"]);
});
