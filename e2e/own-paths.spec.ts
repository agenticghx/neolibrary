import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M14 step 5 "Done when": Samuel can make "Philosophy of science" with Kuhn
// and two titles not available yet, in order; reorder them; add Kuhn's book
// file to its title. Runs after the home project (it adds a book file and
// titles not available yet, which the home project counts).

test.use({ storageState: ADMIN_STATE });
// In order, one at a time (as home.spec.ts): the main test's screenshots show only its own Path in the sidebar.
test.describe.configure({ mode: "default" });

const section = (page: Page, name: string) => page.getByTestId("edit-section").filter({ has: page.getByRole("heading", { level: 2, name }) });
const titlesIn = (page: Page, name: string) => section(page, name).locator("li [class*=name]").allTextContents();
const kindsIn = (page: Page, name: string) => section(page, name).locator("li [class*=kind]");
const onPath = (page: Page, name: string) => page.getByTestId("pillar").filter({ has: page.getByRole("heading", { level: 3, name }) });
const axe = async (page: Page, look: string) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${look} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
};

/** A page in the four looks: accessible, no sideways scroll on a phone, a screenshot for the PR's grid. */
async function fourLooks(page: Page, name: string, ready: () => Promise<void>) {
  await mkdir("screenshots", { recursive: true });
  for (const [size, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload(); // fresh colours; no focus or hover left from earlier clicks
      await ready();
      await page.mouse.move(0, 0); // no hover left on a button where the last click was
      await page.evaluate(() => document.fonts.ready);
      await axe(page, `${size} ${scheme}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/${name}-${size}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("make a Path of sections and titles, reorder them, and add a book file to a title waiting for it", async ({ page, browser }) => {
  await page.goto("/paths/new");
  await page.getByLabel("Name").fill("Philosophy of science");
  await page.getByLabel("What it is for (optional)").fill("How science changes its mind.\nAnd why it takes so long.");
  await page.getByRole("button", { name: "Make the path" }).click();
  await expect(page).toHaveURL(/\/paths\/philosophy-of-science\/edit$/);
  // The sidebar lists it at once.
  await expect(page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: /^Philosophy of science/ })).toBeVisible();

  // An empty Path's edit page starts with what to do next; the description kept its line break.
  const h2s = page.getByRole("main").getByRole("heading", { level: 2 });
  await expect(h2s).toHaveText(["Next: add a first section", "Name"]);
  expect((await page.getByRole("link", { name: "See the path" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const inSidebar = page.getByRole("complementary", { name: "Sidebar" });
  await expect(inSidebar.getByRole("link", { name: /^Philosophy of science No sections yet$/ })).toBeVisible();
  await expect(page.getByLabel("What it is for (optional)")).toHaveValue("How science changes its mind.\nAnd why it takes so long.");
  await fourLooks(page, "path-edit-empty", () => expect(h2s.first()).toHaveText("Next: add a first section"));

  // The empty Path's own page says so, with no empty track.
  await page.goto("/paths/philosophy-of-science");
  await expect(page.getByText("No sections yet. Edit the path to add some.")).toBeVisible();
  await expect(page.getByText("0 sections · 0 available, 0 not available yet")).toBeVisible();
  await expect(page.getByRole("list", { name: /finished/ })).toHaveCount(0);
  expect(await page.getByText("How science changes its mind.").innerText()).toBe("How science changes its mind.\nAnd why it takes so long.");
  await page.goto("/paths/philosophy-of-science/edit");

  // A section needs a name: spaces alone are refused, in words.
  await page.getByLabel("New section").fill("   ");
  await page.getByRole("button", { name: "Add section" }).click();
  await expect(page.getByText("Give the section a name.")).toBeVisible();
  await expect(page.getByTestId("edit-section")).toHaveCount(0);

  const addSection = async (name: string) => {
    await page.getByLabel("New section").fill(name);
    await page.getByRole("button", { name: "Add section" }).click();
    await expect(section(page, name)).toBeVisible();
    await expect(page.getByRole("region", { name: "Add a section" }).getByRole("status")).toHaveText(`Added the section ${name}.`);
  };
  const addNew = async (sectionName: string, title: string, author: string, kind: string) => {
    const form = section(page, sectionName).getByRole("form", { name: `Add a new title to ${sectionName}` });
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Author").fill(author);
    await form.getByLabel("How to read it").selectOption({ label: kind });
    await form.getByRole("button", { name: `Add a new title to ${sectionName}`, exact: true }).click();
    await expect(form.getByRole("status")).toHaveText(`Added ${title}.`);
    const row = section(page, sectionName).locator("li").filter({ has: page.locator("[class*=name]").getByText(title, { exact: true }) });
    await expect(row.locator("[class*=kind]")).toHaveText(kind);
  };

  await addSection("Revolutions");
  await expect(h2s).toHaveText(["Name", "Revolutions"]);
  await expect(inSidebar.getByRole("link", { name: /^Philosophy of science 0 of 1 section started$/ })).toBeVisible();

  // The Path page with a section and no titles yet.
  await page.goto("/paths/philosophy-of-science");
  await expect(page.getByTestId("pillar")).toHaveCount(1);
  await expect(page.getByText("1 section · 0 available, 0 not available yet")).toBeVisible();
  await expect(onPath(page, "Revolutions").getByText("No titles yet. Edit the path to add some.", { exact: true })).toBeVisible();
  await expect(page.getByText("No sections yet.")).toHaveCount(0);
  await page.goto("/paths/philosophy-of-science/edit");

  // "How to read it" is a visible label, with words that say what each choice means; Any order by default.
  const howToRead = section(page, "Revolutions")
    .getByRole("form", { name: "Add a new title to Revolutions" })
    .getByRole("combobox", { name: "How to read it", exact: true });
  await expect(howToRead).toHaveValue("extra");
  await expect(howToRead.locator("option")).toHaveText(["Story first", "Go deeper", "Any order"]);
  const label = section(page, "Revolutions").getByRole("form", { name: "Add a new title to Revolutions" }).getByText("How to read it", { exact: true });
  expect((await label.boundingBox())!.width).toBeGreaterThan(20); // not the 1 px hidden kind

  await addNew("Revolutions", "The Structure of Scientific Revolutions", "Thomas S. Kuhn", "Story first");
  await addNew("Revolutions", "Against Method", "Paul Feyerabend", "Go deeper");
  await addSection("Fiction about science");
  const fromLibrary = section(page, "Fiction about science").getByRole("form", { name: "Add a book from your library to Fiction about science" });
  await fromLibrary.getByLabel("From your library").selectOption({ label: "Frankenstein, by Mary Shelley" });
  await fromLibrary.getByRole("button", { name: "Add a book from your library to Fiction about science", exact: true }).click();
  await expect(fromLibrary.getByRole("status")).toHaveText("Added Frankenstein.");
  await expect(section(page, "Fiction about science").locator("li [class*=name]").getByText("Frankenstein", { exact: true })).toBeVisible();
  await expect(kindsIn(page, "Fiction about science")).toHaveText(["Any order"]);
  await expect(page.getByRole("main").getByText("Plain", { exact: true })).toHaveCount(0);
  // Every Add button says what it adds, and to which section.
  await expect(page.getByRole("main").getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  // Mixed kinds in one section: an Any order title first, then a Story first one.
  await addNew("Fiction about science", "The Dispossessed", "Ursula K. Le Guin", "Story first");

  // Reorder: the first cannot move up (and looks it); moving the second up swaps them, and the order sticks.
  const revolutions = section(page, "Revolutions");
  const status = revolutions.getByTestId("titles-status");
  await expect(revolutions.getByRole("button", { name: "Move up The Structure of Scientific Revolutions" })).toBeDisabled();
  await expect(revolutions.getByRole("button", { name: "Move up The Structure of Scientific Revolutions" })).toHaveCSS("opacity", "0.6");
  await expect(revolutions.getByRole("button", { name: "Move up Against Method" })).toHaveCSS("opacity", "1");
  await revolutions.getByRole("button", { name: "Move up Against Method" }).click();
  await expect.poll(() => titlesIn(page, "Revolutions")).toEqual(["Against Method", "The Structure of Scientific Revolutions"]);
  // It says what happened, and focus stays with the title (its Move up is now off, so on its Move down).
  await expect(status).toHaveText("Moved Against Method to 1 of 2.");
  await expect(revolutions.getByRole("button", { name: "Move down Against Method" })).toBeFocused();
  await expect(kindsIn(page, "Revolutions")).toHaveText(["Go deeper", "Story first"]); // the word moves with its title
  await page.reload();
  expect(await titlesIn(page, "Revolutions")).toEqual(["Against Method", "The Structure of Scientific Revolutions"]);
  await expect(revolutions.getByRole("button", { name: "Move down The Structure of Scientific Revolutions" })).toBeDisabled();
  await revolutions.getByRole("button", { name: "Move down Against Method" }).click();
  await expect.poll(() => titlesIn(page, "Revolutions")).toEqual(["The Structure of Scientific Revolutions", "Against Method"]);
  await expect(status).toHaveText("Moved Against Method to 2 of 2.");
  await expect(revolutions.getByRole("button", { name: "Move up Against Method" })).toBeFocused();

  // The edit page in the four looks (not in pages.ts: the looks projects run before any Path of yours exists).
  await fourLooks(page, "path-edit", () => expect(revolutions).toBeVisible());

  // The Path page: sections, each title in your order with how to read it, and nothing of the reading list's own words.
  await page.getByRole("link", { name: "See the path" }).click();
  await expect(page).toHaveURL(/\/paths\/philosophy-of-science$/);
  await expect(page.getByText("2 sections · 1 available, 3 not available yet")).toBeVisible();
  await expect(page.getByText("The eighteen systems")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit path" })).toHaveAttribute("href", "/paths/philosophy-of-science/edit");
  const fiction = onPath(page, "Fiction about science");
  expect(await fiction.locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("aria-label") ?? a.textContent))).toEqual([
    "Frankenstein",
    "The Dispossessed (not available yet)",
  ]);
  await expect(fiction.locator("ol > li > span:first-child")).toHaveText(["Any order", "Story first"]);
  await expect(fiction.getByText(/more books?$/)).toHaveCount(0);
  await expect(onPath(page, "Revolutions").getByText("Story first", { exact: true })).toBeVisible();
  await expect(onPath(page, "Revolutions").getByText("Go deeper", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText(/^[NE]$/)).toHaveCount(0); // no bare letters, on the page or on covers
  await expect(page.getByRole("list", { name: /^\d of 2 sections finished$/ })).toBeVisible();
  await fourLooks(page, "path-own", () => expect(fiction).toBeVisible());

  // Kuhn's book file arrives: it goes to the title waiting for it, whatever the file's own title.
  await page.getByRole("link", { name: "The Structure of Scientific Revolutions (not available yet)" }).click();
  await expect(page.getByText("Philosophy of science › Revolutions · Story first")).toBeVisible();
  await expect(page.getByRole("main").locator("figure").getByText(/^[NE]$/)).toHaveCount(0);
  await expect(page.getByText("Not available yet. Add the book file (EPUB or PDF) and it attaches here.")).toBeVisible();
  // A file that is not a book is refused in words, and keyboard focus stays on the picker for the next try.
  const picker = page.getByLabel("Choose the book file");
  await picker.focus();
  await picker.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Not a book.") });
  await expect(page.getByTestId("attach-status")).toHaveText("Only EPUB and PDF files can be added.");
  await expect(picker).toBeFocused();
  await page.getByLabel("Choose the book file").setInputFiles({
    name: "kuhn.pdf",
    mimeType: "application/pdf",
    buffer: readFileSync("fixtures/books/descartes-meditation-one.pdf"),
  });
  // The page refreshes with the file in place: a Read button, and the title (the list's, not the file's) Read only.
  await expect(page.getByRole("link", { name: "Read", exact: true })).toBeVisible();
  // The message outlives the picker, and focus moves to Read.
  await expect(page.getByTestId("attach-status")).toHaveText("Added the book file (kuhn.pdf). It is ready to read.");
  await expect(page.getByRole("link", { name: "Read", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The Structure of Scientific Revolutions");
  await expect(page.getByText("Read only · 0% read")).toBeVisible(); // a PDF: narration is EPUB only
  await expect(page.getByLabel("Choose the book file")).toHaveCount(0);

  await page.goto("/paths/philosophy-of-science");
  await expect(page.getByRole("link", { name: "The Structure of Scientific Revolutions", exact: true })).toBeVisible();
  await expect(page.getByText("2 sections · 2 available, 2 not available yet")).toBeVisible();
  // The sidebar counts sections, not pillars, for a Path of yours.
  await expect(page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: /^Philosophy of science \d of 2 sections started$/ })).toBeVisible();

  // /paths lists it, in the same words.
  await page.goto("/paths");
  await expect(page.getByRole("main").getByRole("link", { name: "Philosophy of science", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: "Philosophy of science" })).toContainText(/\d of 2 sections started/);
  await expect(page.getByText("A path is a reading plan: sections of titles, in order.")).toBeVisible();

  // Removing a title takes it off the Path, not out of the library. Two more tabs still show it:
  // their Move and Remove change nothing and show the Path as it is now (no error page).
  await page.goto("/paths/philosophy-of-science/edit");
  const staleMove = await page.context().newPage();
  const staleRemove = await page.context().newPage();
  for (const p of [staleMove, staleRemove]) await p.goto("/paths/philosophy-of-science/edit");
  await section(page, "Revolutions").getByRole("button", { name: "Remove Against Method" }).click();
  await expect.poll(() => titlesIn(page, "Revolutions")).toEqual(["The Structure of Scientific Revolutions"]);
  await expect(section(page, "Revolutions").getByTestId("titles-status")).toHaveText("Removed Against Method. It stays in your library.");
  await expect(section(page, "Revolutions").getByRole("button", { name: "Remove The Structure of Scientific Revolutions" })).toBeFocused();
  await section(staleMove, "Revolutions").getByRole("button", { name: "Move up Against Method" }).click();
  await expect.poll(() => titlesIn(staleMove, "Revolutions")).toEqual(["The Structure of Scientific Revolutions"]);
  await expect(section(staleMove, "Revolutions").getByTestId("titles-status")).toHaveText("That title was not found.");
  await section(staleRemove, "Revolutions").getByRole("button", { name: "Remove Against Method" }).click();
  await expect.poll(() => titlesIn(staleRemove, "Revolutions")).toEqual(["The Structure of Scientific Revolutions"]);
  await expect(section(staleRemove, "Revolutions").getByTestId("titles-status")).toHaveText("That title was not found.");
  for (const p of [staleMove, staleRemove]) await expect(p.getByText("A server error occurred")).toHaveCount(0);
  await staleMove.close();
  await staleRemove.close();

  // Removing a section's last title leaves focus on the section's heading.
  const fictionEdit = section(page, "Fiction about science");
  await fictionEdit.getByRole("button", { name: "Remove Frankenstein" }).click();
  await expect(fictionEdit.getByRole("button", { name: "Remove The Dispossessed" })).toBeFocused();
  await fictionEdit.getByRole("button", { name: "Remove The Dispossessed" }).click();
  await expect(fictionEdit.getByText("No titles yet.")).toBeVisible();
  await expect(fictionEdit.getByRole("heading", { level: 2, name: "Fiction about science" })).toBeFocused();
  await expect(fictionEdit.getByTestId("titles-status")).toHaveText("Removed The Dispossessed. It stays in your library.");

  // A typed title that is already in the library joins it, and the message names the book.
  const newInFiction = fictionEdit.getByRole("form", { name: "Add a new title to Fiction about science" });
  await newInFiction.getByLabel("Title").fill("Frankenstein");
  await newInFiction.getByLabel("Author").fill("Mary Shelley");
  await newInFiction.getByRole("button", { name: "Add a new title to Fiction about science", exact: true }).click();
  await expect(newInFiction.getByRole("status")).toHaveText("Added Frankenstein by Mary Shelley: it was already in your library, so this is the same book.");

  // Another author's book is another title, even when the short titles match.
  await addNew("Revolutions", "Chaos: Making a New Science", "James Gleick", "Any order");
  await addNew("Revolutions", "Chaos: A Very Short Introduction", "Leonard Smith", "Any order");
  expect(await titlesIn(page, "Revolutions")).toEqual(["The Structure of Scientific Revolutions", "Chaos: Making a New Science", "Chaos: A Very Short Introduction"]);
  // Two books could be meant: the reader is asked, and what they typed and chose stays in the form.
  const newTitleIn = section(page, "Fiction about science").getByRole("form", { name: "Add a new title to Fiction about science" });
  await newTitleIn.getByLabel("Title").fill("Chaos");
  await newTitleIn.getByLabel("How to read it").selectOption({ label: "Story first" });
  await newTitleIn.getByRole("button", { name: "Add a new title to Fiction about science", exact: true }).click();
  await expect(newTitleIn.getByRole("status")).toHaveText("More than one book in your library is called Chaos. Add the author to say which, or choose it from your library.");
  await expect(newTitleIn.getByLabel("Title")).toHaveValue("Chaos");
  await expect(newTitleIn.getByLabel("How to read it")).toHaveValue("N");
  // With the author (written another way), it is that book, and the message names it.
  await newTitleIn.getByLabel("Author").fill("Gleick");
  await newTitleIn.getByRole("button", { name: "Add a new title to Fiction about science", exact: true }).click();
  await expect(newTitleIn.getByRole("status")).toHaveText(
    "Added Chaos: Making a New Science by James Gleick: it was already in your library, so this is the same book.",
  );
  await expect(newTitleIn.getByLabel("Title")).toHaveValue(""); // cleared after a success
  // A section lists a book once.
  const newInRevolutions = section(page, "Revolutions").getByRole("form", { name: "Add a new title to Revolutions" });
  await newInRevolutions.getByLabel("Title").fill("chaos");
  await newInRevolutions.getByLabel("Author").fill("Gleick");
  await newInRevolutions.getByRole("button", { name: "Add a new title to Revolutions", exact: true }).click();
  await expect(newInRevolutions.getByRole("status")).toHaveText("Chaos: Making a New Science is already in this section.");
  // A title typed without its author that matches one book joins it, and says how to undo a wrong guess.
  await newInRevolutions.getByLabel("Title").fill("The Grid");
  await newInRevolutions.getByLabel("Author").fill("");
  await newInRevolutions.getByRole("button", { name: "Add a new title to Revolutions", exact: true }).click();
  await expect(newInRevolutions.getByRole("status")).toHaveText(
    "Added The Grid by Bakke: it was already in your library, so this is the same book. If you meant another book, remove it and add it again with its author.",
  );
  // A double click moves a title one place, not two.
  await section(page, "Revolutions").getByRole("button", { name: "Move down The Structure of Scientific Revolutions" }).dblclick();
  await expect(section(page, "Revolutions").getByTestId("titles-status")).toHaveText("Moved The Structure of Scientific Revolutions to 2 of 4.");
  expect(await titlesIn(page, "Revolutions")).toEqual(["Chaos: Making a New Science", "The Structure of Scientific Revolutions", "Chaos: A Very Short Introduction", "The Grid"]);
  // Adding from the keyboard keeps focus on the Add button that was pressed.
  const libraryIn = section(page, "Revolutions").getByRole("form", { name: "Add a book from your library to Revolutions" });
  await libraryIn.getByLabel("From your library").selectOption({ label: "Frankenstein, by Mary Shelley" });
  const addFromLibrary = libraryIn.getByRole("button", { name: "Add a book from your library to Revolutions", exact: true });
  await addFromLibrary.focus();
  await page.keyboard.press("Enter");
  await expect(libraryIn.getByRole("status")).toHaveText("Added Frankenstein.");
  await expect(addFromLibrary).toBeFocused();

  // Renaming: the description can change. (Saving twice shows the message twice; that a screen reader reads it
  // again is the Outcome unit test's job: the line is empty while the form sends.)
  const name = page.getByRole("region", { name: "Name", exact: true });
  await name.getByLabel("What it is for (optional)").fill("How science changes its mind.");
  await name.getByRole("button", { name: "Save", exact: true }).click();
  await expect(name.getByRole("status")).toHaveText("Saved the name and description.");
  await name.getByRole("button", { name: "Save", exact: true }).click();
  await expect(name.getByRole("status")).toHaveText("Saved the name and description.");
  await page.goto("/paths/philosophy-of-science");
  expect(await page.getByText("How science changes its mind.").innerText()).toBe("How science changes its mind.");

  // Another reader cannot open your Path or its edit page: both are not found for them.
  const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const grace = await other.newPage();
  await grace.goto("/sign-in");
  await grace.getByLabel("Email address").fill("grace@example.com"); // made by uploads.spec.ts
  await grace.getByLabel("Password").fill("a long password here");
  await grace.getByRole("button", { name: "Sign in" }).click();
  await expect(grace.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  expect((await grace.request.get("/paths/philosophy-of-science")).status()).toBe(404);
  expect((await grace.request.get("/paths/philosophy-of-science/edit")).status()).toBe(404);
  await other.close();
});

test("a Path named Constructor is your own: sections and Edit path", async ({ page }) => {
  await page.goto("/paths/new");
  // A name of spaces is refused in words, and the description stays.
  await page.getByLabel("Name").fill("   ");
  await page.getByLabel("What it is for (optional)").fill("Kept after a refusal.");
  await page.getByRole("button", { name: "Make the path" }).click();
  await expect(page.getByText("Give the path a name.")).toBeVisible();
  await expect(page.getByLabel("What it is for (optional)")).toHaveValue("Kept after a refusal.");
  await page.getByLabel("Name").fill("Constructor");
  await page.getByRole("button", { name: "Make the path" }).click();
  await expect(page).toHaveURL(/\/paths\/constructor\/edit$/);
  await page.getByRole("link", { name: "See the path" }).click();
  await expect(page.getByText("0 sections · 0 available, 0 not available yet")).toBeVisible();
  await expect(page.getByText("No sections yet. Edit the path to add some.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit path", exact: true })).toHaveAttribute("href", "/paths/constructor/edit");
  // Enter adds the first section, and focus stays in New section for the next one (the form does not move).
  await page.getByRole("link", { name: "Edit path", exact: true }).click();
  await expect(page).toHaveURL(/\/paths\/constructor\/edit$/);
  await page.getByLabel("New section").fill("One");
  await page.getByLabel("New section").press("Enter");
  await expect(page.getByTestId("edit-section")).toHaveCount(1);
  await expect(page.getByLabel("New section")).toBeFocused();

  // A one-word name longer than a phone is wide wraps instead of pushing the page sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/paths/new");
  await page.getByLabel("Name").fill("Pneumonoultramicroscopicsilicovolcanoconiosis");
  await page.getByRole("button", { name: "Make the path" }).click();
  await expect(page).toHaveURL(/\/paths\/pneumonoultramicroscopicsilicovolcanoconiosis\/edit$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/paths/pneumonoultramicroscopicsilicovolcanoconiosis");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
