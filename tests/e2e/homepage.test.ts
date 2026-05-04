import { expect, type Page, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  deleteTestUser,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

const workspaceUrlPattern =
  /\/chat\/(?:new\?projectId=[\w-]+&topicId=[\w-]+|[\w-]+)$/;
const extractionFixture = {
  projectName: "Migration Launch",
  topics: [
    {
      name: "Release scope",
      decisions: [
        {
          type: "goal",
          content: "Ship the migration launcher to pilot users.",
        },
        {
          type: "constraint",
          content: "Do not enable billing during the pilot.",
        },
      ],
    },
  ],
};

async function mockProjectExtraction(page: Page) {
  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      json: extractionFixture,
      status: 200,
    });
  });
}

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

  test("keeps create-project actions visible while the prompt textarea scrolls", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "+ New project" }).first().click();

    const textarea = page.getByPlaceholder(
      "Describe the project, or paste anything you have..."
    );
    const longPrompt = Array.from(
      { length: 80 },
      (_, index) =>
        `Decision ${index + 1}: V1 should keep the workspace flow focused and avoid billing setup.`
    ).join("\n");

    await textarea.fill(longPrompt);

    await expect(
      page.getByRole("button", { name: "Start blank" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Extract →" })).toBeVisible();
    expect(
      await textarea.evaluate((node) => {
        const element = node as HTMLTextAreaElement;
        return (
          getComputedStyle(element).overflowY === "auto" &&
          element.scrollHeight > element.clientHeight
        );
      })
    ).toBe(true);
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

  test("clicking a homepage project opens that workspace", async ({ page }) => {
    await page.getByRole("button", { name: "+ New project" }).first().click();
    await page.getByRole("button", { name: "Start blank" }).click();
    await expect(page).toHaveURL(workspaceUrlPattern);

    await page.goto("/");
    await expect(page.getByText("Untitled project")).toBeVisible();

    await page.getByRole("link", { name: /Untitled project/ }).click();

    await expect(page).toHaveURL(workspaceUrlPattern);
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
    await expect(page.locator('[data-topic-label="General"]')).toBeVisible();
  });

  test("extract review confirms into a new project", async ({ page }) => {
    await mockProjectExtraction(page);
    await page.getByRole("button", { name: "+ New project" }).first().click();

    const extractButton = page.getByRole("button", { name: "Extract →" });
    await expect(extractButton).toBeDisabled();

    await page
      .getByPlaceholder("Describe the project, or paste anything you have...")
      .fill("Build a decision memory layer for AI-assisted thinking.");

    await expect(extractButton).toBeEnabled();
    await extractButton.click();

    await expect(
      page.getByRole("button", { exact: true, name: "Migration Launch" })
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Confirm 2 in 1 topics →" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Confirm 2 in 1 topics →" }).click();

    await expect(page).toHaveURL(workspaceUrlPattern);
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
    await expect(
      page.locator('[data-topic-label="Release scope"]')
    ).toBeVisible();
  });

  test("extract review explains why confirm is unavailable with no checked items", async ({
    page,
  }) => {
    await mockProjectExtraction(page);
    await page.getByRole("button", { name: "+ New project" }).first().click();
    await page
      .getByPlaceholder("Describe the project, or paste anything you have...")
      .fill("Project: Migration Launch. Do not enable billing during pilot.");
    await page.getByRole("button", { name: "Extract →" }).click();
    await expect(
      page.getByRole("button", { exact: true, name: "Migration Launch" })
    ).toBeVisible({ timeout: 10_000 });

    const checkboxes = page.getByRole("checkbox");
    const count = await checkboxes.count();

    for (let index = 0; index < count; index += 1) {
      await checkboxes.nth(index).uncheck();
    }

    await expect(
      page.getByRole("button", { name: "Select at least one item" })
    ).toBeDisabled();
  });
});
