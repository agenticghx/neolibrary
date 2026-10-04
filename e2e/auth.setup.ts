import { expect, test as setup } from "@playwright/test";
import { ADMIN, ADMIN_STATE, SETUP_CODE } from "./pages";

// Creates the owner account through /setup (or signs in, if a reused local
// server already has it) and saves the session for the other tests.
setup("create the owner account", async ({ page }) => {
  await page.goto("/setup");
  if (page.url().endsWith("/setup")) {
    await page.getByLabel("Setup code").fill(SETUP_CODE);
    await page.getByLabel("Your name").fill(ADMIN.name);
    await page.getByLabel("Email address").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Create owner account" }).click();
  } else {
    await page.getByLabel("Email address").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Hidden Machinery", level: 1 })).toBeVisible();
  await page.context().storageState({ path: ADMIN_STATE });
});
