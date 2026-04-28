import { expect, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  deleteTestUser,
  hasModelProviderE2EConfig,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

test.describe("Workspace Phase 2 flow", () => {
  test.skip(
    !hasSupabaseE2EConfig || !hasModelProviderE2EConfig,
    "Supabase auth and at least one model provider must be configured for workspace e2e."
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

  test("bridges workspace topics, truth panel, decision confirmation, and segment navigation", async ({
    page,
  }) => {
    const suffix = Date.now().toString().slice(-6);
    const topicA = `Product ${suffix}`;
    const seedPrompt =
      "Reply with exactly these three sentences and nothing else: We will use PostgreSQL. Archived topics must remain read-only. Clearing chat creates a new conversation segment.";
    const scrollPrompt = `${Array.from(
      { length: 180 },
      (_, index) => `scroll-check line ${index + 1}`
    ).join(
      "\n"
    )}\n\nNow reply with the word STREAM repeated on 120 separate lines.`;

    const topicDialog = page.getByRole("dialog");
    const chatHeader = page.locator("header").first();
    const truthPanel = page.getByTestId("truth-panel");
    const decisionTree = truthPanel.getByTestId("decision-tree");
    const candidatePoolToggle = page.getByTestId("candidate-pool-toggle");
    const candidatePoolList = page.getByTestId("candidate-pool-list");

    await expect(page.getByRole("button", { name: "New Topic" })).toBeEnabled();
    await expect(truthPanel.getByTestId("candidate-pool")).toHaveCount(0);
    await expect(candidatePoolToggle).toBeVisible();
    await expect(candidatePoolToggle).toHaveAttribute("aria-expanded", "false");

    await page.getByRole("button", { name: "New Topic" }).click();
    await expect(topicDialog).toBeVisible();
    await topicDialog.getByPlaceholder("Topic label").fill(topicA);
    await topicDialog.getByRole("button", { name: "Create" }).click();

    await expect(chatHeader.getByText(topicA, { exact: true })).toBeVisible();

    await page.getByTestId("multimodal-input").fill(seedPrompt);
    await page.getByTestId("send-button").click();

    await expect(
      page
        .locator("[data-role='assistant'] [data-testid='message-content']")
        .last()
    ).toContainText("PostgreSQL", { timeout: 30_000 });

    await expect(candidatePoolToggle).toContainText(/\d+ candidates? pending/, {
      timeout: 10_000,
    });
    await expect(candidatePoolToggle).toHaveAttribute("aria-expanded", "false");

    await candidatePoolToggle.click();
    await expect(candidatePoolToggle).toHaveAttribute("aria-expanded", "true");
    await expect(candidatePoolList).toContainText("We will use PostgreSQL");

    await page.getByRole("button", { name: "Confirm Selected" }).click();

    await expect(
      decisionTree.getByText("We will use PostgreSQL").first()
    ).toBeVisible({
      timeout: 15_000,
    });

    await page
      .getByTestId("multimodal-input")
      .fill("What database are we using? Reply with one sentence.");
    await page.getByTestId("send-button").click();

    await expect(
      page
        .locator("[data-role='assistant'] [data-testid='message-content']")
        .last()
    ).toContainText("PostgreSQL", { timeout: 30_000 });

    await page.locator('[data-topic-label="General"]').evaluate((element) => {
      (element as HTMLButtonElement).click();
    });

    await expect(
      chatHeader.getByText("General", { exact: true })
    ).toBeVisible();
    await expect(decisionTree.getByText("We will use PostgreSQL")).toHaveCount(
      0
    );
    await expect(page.locator("[data-role='user']")).toHaveCount(0);

    await page.locator(`[data-topic-label="${topicA}"]`).evaluate((element) => {
      (element as HTMLButtonElement).click();
    });

    await expect(chatHeader.getByText(topicA, { exact: true })).toBeVisible();
    await expect(candidatePoolToggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      decisionTree.getByText("We will use PostgreSQL").first()
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("[data-role='user']").first()).toContainText(
      seedPrompt
    );

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.locator("[data-role='user']")).toHaveCount(0, {
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.locator("[data-role='user']").first()).toContainText(
      seedPrompt,
      {
        timeout: 15_000,
      }
    );

    await page.getByRole("button", { name: "Forward" }).click();
    await expect(page.locator("[data-role='user']")).toHaveCount(0, {
      timeout: 15_000,
    });

    await page.getByTestId("multimodal-input").fill(scrollPrompt);
    await page.getByTestId("send-button").click();

    await expect(page.getByTestId("stop-button")).toBeVisible({
      timeout: 10_000,
    });

    const viewport = page.getByTestId("messages-viewport");
    await page.waitForTimeout(1000);

    const beforeScrollState = await viewport.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    expect(
      beforeScrollState.scrollHeight - beforeScrollState.clientHeight
    ).toBeGreaterThan(250);

    await viewport.evaluate((element) => {
      element.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.waitForTimeout(2000);

    const scrollState = await viewport.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    expect(scrollState.scrollTop).toBeLessThan(
      scrollState.scrollHeight - scrollState.clientHeight - 150
    );

    await page
      .getByTestId("stop-button")
      .click()
      .catch(() => {
        // Streaming may have already finished before we stop it.
      });
  });
});
