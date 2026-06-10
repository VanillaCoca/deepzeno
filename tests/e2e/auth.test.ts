import { expect, test } from "@playwright/test";

test.describe("Authentication Pages", () => {
  test("login page renders the passwordless sign-in flow", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: "Welcome to ZENO" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" })
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toHaveText(
      "Continue with email"
    );
    // Passwordless: there is no password field anymore.
    await expect(page.getByLabel("Password")).toHaveCount(0);
  });

  test("register route redirects to the unified login page", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("button", { name: "Continue with Google" })
    ).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toHaveText(
      "Continue with email"
    );
  });

  test("unauthenticated users are redirected to login", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login/);
  });
});
