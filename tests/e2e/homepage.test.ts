import { expect, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  deleteTestUser,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

const workspaceUrlPattern =
  /\/chat\/(?:new\?projectId=[\w-]+&topicId=[\w-]+|[\w-]+)$/;

test.describe("Homepage and create-project flow", () => {
  test.skip(
    !hasSupabaseE2EConfig,
    "Supabase auth must be configured for homepage e2e."
  );

  let user: Awaited<ReturnType<typeof createConfirmedTestUser>> | null = null;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await signInThroughLoginPage(page, user);
    await expect(page).toHaveURL(/\/$/);
  });

  test.afterEach(async () => {
    if (user) {
      await deleteTestUser(user.id);
      user = null;
    }
  });

  test("shows the empty homepage state for a new user", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Projects", exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("You haven't started any projects yet.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "+ New project" }).first()
    ).toBeVisible();
  });

  test("start blank creates an untitled project and redirects into the workspace", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "+ New project" }).first().click();
    await expect(
      page.getByRole("heading", { name: "Start with what you have" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Start blank" }).click();

    await expect(page).toHaveURL(workspaceUrlPattern);
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
    await expect(page.locator('[data-topic-label="General"]')).toBeVisible();
  });

  test("extract review confirms into a new project", async ({ page }) => {
    await page.getByRole("button", { name: "+ New project" }).first().click();

    const extractButton = page.getByRole("button", { name: "Extract →" });
    await expect(extractButton).toBeDisabled();

    await page
      .getByPlaceholder("Describe the project, or paste anything you have...")
      .fill("Build a decision memory layer for AI-assisted thinking.");

    await expect(extractButton).toBeEnabled();
    await extractButton.click();

    await expect(
      page.getByText("Extracting decisions and topics...")
    ).toBeVisible();
    await expect(page.getByText("Zeno V1")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Confirm 6 in 3 topics →" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Confirm 6 in 3 topics →" }).click();

    await expect(page).toHaveURL(workspaceUrlPattern);
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
    await expect(
      page.locator('[data-topic-label="Product identity"]')
    ).toBeVisible();
  });
});
