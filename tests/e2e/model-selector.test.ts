import { type APIRequestContext, expect, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  deleteTestUser,
  hasModelProviderE2EConfig,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

type ModelsPayload = {
  models: Array<{
    id: string;
    name: string;
    providerLabel: string;
  }>;
  defaultModelId?: string;
};

test.describe("Model Selector", () => {
  // biome-ignore lint/suspicious/noSkippedTests: these e2e cases require configured Supabase auth and at least one model provider
  test.skip(
    !hasSupabaseE2EConfig || !hasModelProviderE2EConfig,
    "Supabase auth and at least one model provider must be configured for model selector e2e."
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

  async function getModelsPayload(request: APIRequestContext) {
    const response = await request.get("/api/models");
    expect(response.ok()).toBeTruthy();
    return (await response.json()) as ModelsPayload;
  }

  test("displays the currently selected configured model", async ({
    page,
    request,
  }) => {
    const payload = await getModelsPayload(request);
    expect(payload.models.length).toBeGreaterThan(0);

    const expectedModel =
      payload.models.find((model) => model.id === payload.defaultModelId) ??
      payload.models[0];

    await expect(page.getByTestId("model-selector")).toContainText(
      expectedModel.name
    );
  });

  test("opens the selector and shows provider groups from the active models API", async ({
    page,
    request,
  }) => {
    const payload = await getModelsPayload(request);
    const providerGroups = [
      ...new Set(payload.models.map((m) => m.providerLabel)),
    ];

    await page.getByTestId("model-selector").click();
    await expect(page.getByPlaceholder("Search models...")).toBeVisible();

    for (const providerLabel of providerGroups) {
      await expect(
        page.getByText(providerLabel, { exact: true })
      ).toBeVisible();
    }
  });

  test("searches configured models without hardcoded template names", async ({
    page,
    request,
  }) => {
    const payload = await getModelsPayload(request);
    const targetModel = payload.models[0];
    const query = targetModel.name.split(/\s+/)[0] ?? targetModel.name;

    await page.getByTestId("model-selector").click();
    await page.getByPlaceholder("Search models...").fill(query);

    await expect(
      page.getByText(targetModel.name, { exact: true })
    ).toBeVisible();
  });

  test("updates the selected model when another active model is chosen", async ({
    page,
    request,
  }) => {
    const payload = await getModelsPayload(request);
    expect(payload.models.length).toBeGreaterThan(0);

    if (payload.models.length === 1) {
      await expect(page.getByTestId("model-selector")).toContainText(
        payload.models[0].name
      );
      await page.reload();
      await expect(page.getByTestId("model-selector")).toContainText(
        payload.models[0].name
      );
      return;
    }

    const initialModel =
      payload.models.find((model) => model.id === payload.defaultModelId) ??
      payload.models[0];
    const nextModel =
      payload.models.find((model) => model.id !== initialModel.id) ??
      payload.models[0];

    await page.getByTestId("model-selector").click();
    await page.getByText(nextModel.name, { exact: true }).click();

    await expect(page.getByTestId("model-selector")).toContainText(
      nextModel.name
    );

    await page.reload();
    await expect(page.getByTestId("model-selector")).toContainText(
      nextModel.name
    );
  });
});
