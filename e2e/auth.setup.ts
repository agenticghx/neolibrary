import { expect, test as setup } from "@playwright/test";
import { ADMIN, ADMIN_STATE, SETUP_CODE } from "./pages";

// Creates the owner account through /setup (or signs in, if a reused local
// server already has it), adds the Hidden Machinery reading list from the
// empty Home (set-up no longer adds it, M14 D6; many tests use it), and
// saves the session for the other tests.
setup("create the owner account", async ({ page }) => {
  await page.goto("/setup");
  if (page.url().endsWith("/setup")) {
    await page.getByLabel("Setup code").fill(SETUP_CODE);
    await page.getByLabel("Your name").fill(ADMIN.name);
    await page.getByLabel("Email address").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Create owner account" }).click();
    // Set-up adds no Path any more (M14 D6): the owner starts with an empty library.
    await expect(page.getByText(/Your library is empty\./)).toBeVisible();
    expect((await page.request.get("/paths/hidden-machinery")).status()).toBe(404);
  } else {
    await page.getByLabel("Email address").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  if ((await page.request.get("/paths/hidden-machinery")).status() === 404) {
    await page.getByRole("button", { name: "Add this path" }).click();
    await expect(page).toHaveURL(/\/paths\/hidden-machinery$/);
    await expect(page.getByRole("heading", { name: "Hidden Machinery", level: 1 })).toBeVisible();
  }
  await page.context().storageState({ path: ADMIN_STATE });
});
