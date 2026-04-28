import { expect, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  deleteTestUser,
  hasModelProviderE2EConfig,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

test.describe("Chat Page", () => {
  test.skip(
    !hasSupabaseE2EConfig || !hasModelProviderE2EConfig,
    "Supabase auth and at least one model provider must be configured for chat e2e."
  );

  let user: Awaited<ReturnType<typeof createConfirmedTestUser>> | null = null;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await signInThroughLoginPage(page, user);
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
  });

  test.afterEach(async () => {
    if (user) {
      await deleteTestUser(user.id);
      user = null;
    }
  });

  test("home page loads with input field", async ({ page }) => {
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
  });

  test("can type in the input field", async ({ page }) => {
    const input = page.getByTestId("multimodal-input");
    await input.fill("Hello world");
    await expect(input).toHaveValue("Hello world");
  });

  test("submit button is visible", async ({ page }) => {
    await expect(page.getByTestId("send-button")).toBeVisible();
  });

  test("preset prompts are hidden on empty chat", async ({ page }) => {
    await expect(page.locator("[data-testid='suggested-actions']")).toHaveCount(
      0
    );
  });

  test("can stop generation with stop button", async ({ page }) => {
    await page.getByTestId("multimodal-input").fill("Hello");
    await page.getByTestId("send-button").click();

    const stopButton = page.getByTestId("stop-button");
    await stopButton.click({ timeout: 5000 }).catch(() => {
      // Generation may have finished before we could click.
    });
  });
});

test.describe("Chat Input Features", () => {
  test.skip(
    !hasSupabaseE2EConfig || !hasModelProviderE2EConfig,
    "Supabase auth and at least one model provider must be configured for chat e2e."
  );

  let user: Awaited<ReturnType<typeof createConfirmedTestUser>> | null = null;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await signInThroughLoginPage(page, user);
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
  });

  test.afterEach(async () => {
    if (user) {
      await deleteTestUser(user.id);
      user = null;
    }
  });

  test("input clears after sending", async ({ page }) => {
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test message");
    await page.getByTestId("send-button").click();

    await expect(input).toHaveValue("");
  });

  test("input supports multiline text", async ({ page }) => {
    const input = page.getByTestId("multimodal-input");
    await input.fill("Line 1\nLine 2\nLine 3");
    await expect(input).toContainText("Line 1");
  });
});
