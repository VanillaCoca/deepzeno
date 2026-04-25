import { expect, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  deleteTestUser,
  hasModelProviderE2EConfig,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

const CHAT_URL_REGEX = /\/chat\/[\w-]+/;
const ERROR_TEXT_REGEX = /error|failed|trouble|oops/i;

test.describe("Chat API Integration", () => {
  // biome-ignore lint/suspicious/noSkippedTests: these e2e cases require configured Supabase auth and at least one model provider
  test.skip(
    !hasSupabaseE2EConfig || !hasModelProviderE2EConfig,
    "Supabase auth and at least one model provider must be configured for chat api e2e."
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

  test("sends message and receives AI response", async ({ page }) => {
    const input = page.getByTestId("multimodal-input");
    await input.fill("Hello");
    await page.getByTestId("send-button").click();

    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(assistantMessage).toBeVisible({ timeout: 30_000 });

    const content = await assistantMessage.textContent();
    expect(content?.length).toBeGreaterThan(0);
  });

  test("redirects to /chat/:id after sending message", async ({ page }) => {
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test redirect");
    await page.getByTestId("send-button").click();

    await expect(page).toHaveURL(CHAT_URL_REGEX, { timeout: 10_000 });
  });

  test("clears input after sending", async ({ page }) => {
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test message");
    await page.getByTestId("send-button").click();

    await expect(input).toHaveValue("");
  });

  test("shows stop button during generation", async ({ page }) => {
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test");
    await page.getByTestId("send-button").click();

    const stopButton = page.getByTestId("stop-button");
    await expect(stopButton).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Chat Error Handling", () => {
  // biome-ignore lint/suspicious/noSkippedTests: these e2e cases require configured Supabase auth and at least one model provider
  test.skip(
    !hasSupabaseE2EConfig || !hasModelProviderE2EConfig,
    "Supabase auth and at least one model provider must be configured for chat api e2e."
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

  test("handles API error gracefully", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      });
    });

    const input = page.getByTestId("multimodal-input");
    await input.fill("Test error");
    await page.getByTestId("send-button").click();

    await expect(page.getByText(ERROR_TEXT_REGEX).first()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("Suggested Actions", () => {
  // biome-ignore lint/suspicious/noSkippedTests: these e2e cases require configured Supabase auth and at least one model provider
  test.skip(
    !hasSupabaseE2EConfig || !hasModelProviderE2EConfig,
    "Supabase auth and at least one model provider must be configured for chat api e2e."
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

  test("suggested actions are clickable", async ({ page }) => {
    const suggestions = page.locator(
      "[data-testid='suggested-actions'] button"
    );
    const count = await suggestions.count();

    if (count > 0) {
      await suggestions.first().click();
      await expect(page).toHaveURL(CHAT_URL_REGEX, { timeout: 10_000 });
    }
  });
});
