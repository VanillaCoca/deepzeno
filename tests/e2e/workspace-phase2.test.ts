import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  createSupabaseE2EClient,
  deleteTestUser,
  hasModelProviderE2EConfig,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

const hasPlaywrightMockModel = Boolean(
  process.env.PLAYWRIGHT ||
    process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.CI_PLAYWRIGHT
);

async function createTopicViaApi(page: Page, label: string) {
  const bootstrapResponse = await page.request.get("/api/workspace/bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrapPayload = (await bootstrapResponse.json()) as {
    workspace: { activeProjectId: string };
  };
  const topicResponse = await page.request.post("/api/workspace/topics", {
    data: {
      projectId: bootstrapPayload.workspace.activeProjectId,
      label,
    },
  });
  expect(topicResponse.ok()).toBeTruthy();

  const topicPayload = (await topicResponse.json()) as {
    workspace: {
      activeProjectId: string;
      activeTopicId: string;
      currentConversationId: string;
    };
  };

  return {
    conversationId: topicPayload.workspace.currentConversationId,
    projectId: topicPayload.workspace.activeProjectId,
    topicId: topicPayload.workspace.activeTopicId,
  };
}

test.describe("Workspace IR panel flow", () => {
  // biome-ignore lint/suspicious/noSkippedTests: conditional e2e requires Supabase auth.
  test.skip(
    !hasSupabaseE2EConfig,
    "Supabase auth must be configured for workspace IR e2e."
  );

  let user: Awaited<ReturnType<typeof createConfirmedTestUser>> | null = null;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await signInThroughLoginPage(page, user);
    await page.goto("/chat/new");
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
  });

  test.afterEach(async () => {
    if (user) {
      await deleteTestUser(user.id);
      user = null;
    }
  });

  test("shows IR candidates in the right panel and confirms through detail", async ({
    page,
  }) => {
    const suffix = Date.now().toString().slice(-6);
    const topicLabel = `IR ${suffix}`;
    const { projectId, topicId } = await createTopicViaApi(page, topicLabel);
    const draftResponse = await page.request.post("/api/ir/draft", {
      data: {
        project_id: projectId,
        topic_id: topicId,
        kind: "plan",
        subtype: "decision",
        title: "V1 uses Supabase IR tables",
        content: "The new IR loop stores candidates in ir_nodes.",
        rationale: "Issue #5 defines ir_nodes as the candidate/truth surface.",
        source_layer: "manual",
        created_by: "user",
        initial_status: "pending",
      },
    });
    if (draftResponse.status() === 503) {
      // biome-ignore lint/suspicious/noSkippedTests: IR tables are optional in older test databases.
      test.skip(true, "IR migrations are not applied in this test database.");
    }

    expect(draftResponse.ok()).toBeTruthy();

    const ideaResponse = await page.request.post("/api/ir/draft", {
      data: {
        project_id: projectId,
        topic_id: topicId,
        kind: "hypothesis",
        title: "Bilingual sweep accuracy needs a separate eval set",
        content: "This is a lower-confidence idea from sweep.",
        rationale: "It should stay ambient until promoted.",
        source_layer: "sweep",
        created_by: "ai",
        initial_status: "idea",
        extraction_confidence: 0.62,
      },
    });
    expect(ideaResponse.ok()).toBeTruthy();

    await page.goto(`/chat/new?projectId=${projectId}&topicId=${topicId}`);
    await expect(page.getByTestId("ir-panel")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Ideas \(1\)/ })
    ).toBeVisible();
    await expect(
      page.getByText("Bilingual sweep accuracy needs a separate eval set")
    ).toHaveCount(0);
    await page.getByRole("button", { name: /Ideas \(1\)/ }).click();
    await expect(page.getByTestId("ir-ideas-zone")).toContainText(
      "Bilingual sweep accuracy needs a separate eval set"
    );
    await expect(
      page.getByRole("button", { name: /Candidates \(1\)/ })
    ).toBeVisible();
    await expect(page.getByTestId("ir-candidates-zone")).toContainText(
      "V1 uses Supabase IR tables"
    );
    await expect(page.getByTestId("candidate-pool")).toHaveCount(0);

    await page.getByText("V1 uses Supabase IR tables").click();
    await expect(page.getByTestId("ir-detail-pane")).toContainText(
      "Issue #5 defines ir_nodes"
    );

    await page
      .getByTestId("ir-detail-pane")
      .getByRole("button", { exact: true, name: "Confirm" })
      .click();

    await expect(page.getByTestId("ir-truth-zone")).toContainText(
      "V1 uses Supabase IR tables",
      { timeout: 10_000 }
    );
  });

  test("uses the ZENO logo as the project-selection escape hatch", async ({
    page,
  }) => {
    await expect(
      page.getByRole("link", { name: "Back to project selection" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "New Project" })
    ).toHaveCount(0);
    await expect(page.locator("select")).toHaveCount(0);

    await page.getByRole("link", { name: "Back to project selection" }).click();
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("button", { name: /New project/i })
    ).toBeVisible();
  });

  test("persists AI inline IR markers as pending candidates", async ({
    page,
  }) => {
    // biome-ignore lint/suspicious/noSkippedTests: this case needs the deterministic Playwright model.
    test.skip(
      !(hasModelProviderE2EConfig && hasPlaywrightMockModel),
      "Set PLAYWRIGHT=True and at least one model provider env var to exercise the deterministic inline-marker mock."
    );

    const suffix = Date.now().toString().slice(-6);
    const { projectId, topicId } = await createTopicViaApi(
      page,
      `Inline ${suffix}`
    );
    const preflightResponse = await page.request.get(
      `/api/ir?project_id=${projectId}&topic_id=${topicId}&status=pending`
    );

    if (preflightResponse.status() === 503) {
      // biome-ignore lint/suspicious/noSkippedTests: IR tables are optional in older test databases.
      test.skip(true, "IR migrations are not applied in this test database.");
    }

    expect(preflightResponse.ok()).toBeTruthy();

    await page.goto(`/chat/new?projectId=${projectId}&topicId=${topicId}`);
    await page
      .getByTestId("multimodal-input")
      .fill("inline marker test: we decided V1 excludes BYOK.");
    await page.getByTestId("send-button").click();

    await expect(
      page.getByText("Inline marker test excludes BYOK")
    ).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/ir?project_id=${projectId}&topic_id=${topicId}&status=pending`
        );

        if (!response.ok()) {
          return "";
        }

        const payload = (await response.json()) as {
          nodes: Array<{ title: string }>;
        };

        return JSON.stringify(payload.nodes);
      })
      .toContain("Inline marker test excludes BYOK");
  });

  test("uses Explore new idea instead of the old clear action", async ({
    page,
  }) => {
    await expect(
      page.getByRole("button", { name: "Explore new idea" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear" })).toHaveCount(0);

    await page.getByRole("button", { name: "Explore new idea" }).click();
    await expect(
      page.getByRole("heading", { name: "Explore new idea" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("blocking manual sweep extracts chat turns into IR candidates", async ({
    page,
  }) => {
    const suffix = Date.now().toString().slice(-6);
    const topicLabel = `Sweep ${suffix}`;
    const uniqueDecision = `candidate-only sweep ${suffix}`;
    const { conversationId, projectId, topicId } = await createTopicViaApi(
      page,
      topicLabel
    );
    const supabase = createSupabaseE2EClient();
    const { error } = await supabase.from("messages").insert({
      id: randomUUID(),
      conversation_id: conversationId,
      topic_id: topicId,
      project_id: projectId,
      role: "user",
      content: `We decided ${uniqueDecision}: AI and MCP must only write pending candidates, never active truth.`,
      created_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    const sweepResponse = await page.request.post("/api/sweep/manual", {
      data: {
        project_id: projectId,
        chat_session_id: conversationId,
        blocking: true,
      },
    });
    if (sweepResponse.status() === 503) {
      // biome-ignore lint/suspicious/noSkippedTests: IR tables are optional in older test databases.
      test.skip(true, "IR migrations are not applied in this test database.");
    }

    expect(sweepResponse.ok()).toBeTruthy();

    const sweepPayload = (await sweepResponse.json()) as {
      status: string;
      candidates_created: number;
      ideas_created: number;
    };
    expect(sweepPayload.status).toBe("completed");
    expect(
      sweepPayload.candidates_created + sweepPayload.ideas_created
    ).toBeGreaterThan(0);

    await expect
      .poll(async () => {
        const pendingResponse = await page.request.get(
          `/api/ir?project_id=${projectId}&topic_id=${topicId}&status=pending`
        );

        if (!pendingResponse.ok()) {
          return "";
        }

        const payload = (await pendingResponse.json()) as {
          nodes: Array<{ title: string; content: string | null }>;
        };

        return JSON.stringify(payload.nodes).toLowerCase();
      })
      .toContain("pending candidates");
    await expect
      .poll(async () => {
        const pendingResponse = await page.request.get(
          `/api/ir?project_id=${projectId}&topic_id=${topicId}&status=pending`
        );

        if (!pendingResponse.ok()) {
          return "";
        }

        const payload = (await pendingResponse.json()) as {
          nodes: Array<{ title: string; content: string | null }>;
        };

        return JSON.stringify(payload.nodes).toLowerCase();
      })
      .toContain("never active truth");
  });
});
