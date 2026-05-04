import { expect, test } from "@playwright/test";

test.describe("Authentication Pages", () => {
  test("login page renders the current single-page auth flow", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: "Welcome to ZENO" })
    ).toBeVisible();
    await expect(
      page.getByText("Sign in to enter the workspace", { exact: false })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account" }).first()
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toHaveText(
      "Sign in"
    );
  });

  test("register route redirects into login page register mode", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(page).toHaveURL(/\/login\?mode=register$/);
    await expect(page.locator('form button[type="submit"]')).toHaveText(
      "Create account"
    );
  });

  test("auth mode toggles update the submit action on the same page", async ({
    page,
  }) => {
    await page.goto("/login");

    const submitButton = page.locator('form button[type="submit"]');

    await expect(submitButton).toHaveText("Sign in");
    await page.getByRole("button", { name: "Create account" }).first().click();
    await expect(submitButton).toHaveText("Create account");
    await page.getByRole("button", { name: "Sign in" }).first().click();
    await expect(submitButton).toHaveText("Sign in");
  });

  test("unauthenticated users are redirected to login", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login\?next=%2F$/);
  });
});
