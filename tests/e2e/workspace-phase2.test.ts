import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  createSupabaseE2EClient,
  deleteTestUser,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

test.describe("Workspace IR panel flow", () => {
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
    const bootstrapResponse = await page.request.get(
      "/api/workspace/bootstrap"
    );
    expect(bootstrapResponse.ok()).toBeTruthy();

    const bootstrapPayload = (await bootstrapResponse.json()) as {
      workspace: { activeProjectId: string };
    };
    const topicResponse = await page.request.post("/api/workspace/topics", {
      data: {
        projectId: bootstrapPayload.workspace.activeProjectId,
        label: topicLabel,
      },
    });
    expect(topicResponse.ok()).toBeTruthy();

    const topicPayload = (await topicResponse.json()) as {
      workspace: {
        activeProjectId: string;
        activeTopicId: string;
      };
    };
    const projectId = topicPayload.workspace.activeProjectId;
    const topicId = topicPayload.workspace.activeTopicId;
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
      test.skip(true, "IR migrations are not applied in this test database.");
    }

    expect(draftResponse.ok()).toBeTruthy();

    await page.goto(`/chat/new?projectId=${projectId}&topicId=${topicId}`);
    await expect(page.getByTestId("ir-panel")).toBeVisible();
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
    const bootstrapResponse = await page.request.get(
      "/api/workspace/bootstrap"
    );
    expect(bootstrapResponse.ok()).toBeTruthy();

    const bootstrapPayload = (await bootstrapResponse.json()) as {
      workspace: { activeProjectId: string };
    };
    const topicResponse = await page.request.post("/api/workspace/topics", {
      data: {
        projectId: bootstrapPayload.workspace.activeProjectId,
        label: topicLabel,
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
    const projectId = topicPayload.workspace.activeProjectId;
    const topicId = topicPayload.workspace.activeTopicId;
    const conversationId = topicPayload.workspace.currentConversationId;
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

        return JSON.stringify(payload.nodes);
      })
      .toContain(uniqueDecision);
  });
});
