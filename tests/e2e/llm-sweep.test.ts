import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  createSupabaseE2EClient,
  deleteTestUser,
  hasModelProviderE2EConfig,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

const hasRealModelProviderConfig =
  hasModelProviderE2EConfig &&
  !(process.env.PLAYWRIGHT || process.env.PLAYWRIGHT_TEST_BASE_URL);

async function ensureIRMigration() {
  if (!hasSupabaseE2EConfig) {
    return false;
  }

  const supabase = createSupabaseE2EClient();
  const irResult = await supabase
    .from("ir_nodes")
    .select("id,topic_id,status")
    .limit(1);
  const topicResult = await supabase
    .from("topics")
    .select("id,status")
    .limit(1);

  return !(irResult.error || topicResult.error);
}

test.describe("Real LLM IR sweep", () => {
  // biome-ignore lint/suspicious/noSkippedTests: requires external Supabase and LLM credentials.
  test.skip(
    !(hasSupabaseE2EConfig && hasRealModelProviderConfig),
    "Supabase and a real model provider key must be configured."
  );

  let user: Awaited<ReturnType<typeof createConfirmedTestUser>> | null = null;

  test.beforeEach(async ({ page }) => {
    // biome-ignore lint/suspicious/noSkippedTests: migration is optional in older shared databases.
    test.skip(!(await ensureIRMigration()), "IR migration is not applied.");

    user = await createConfirmedTestUser();
    await signInThroughLoginPage(page, user);
  });

  test.afterEach(async () => {
    if (user) {
      await deleteTestUser(user.id);
      user = null;
    }
  });

  test("blocking sweep uses configured LLM provider and writes pending IR", async ({
    page,
  }) => {
    const bootstrapResponse = await page.request.get(
      "/api/workspace/bootstrap"
    );
    expect(bootstrapResponse.ok()).toBeTruthy();
    const bootstrap = (await bootstrapResponse.json()) as {
      workspace: {
        activeProjectId: string;
      };
    };
    const topicResponse = await page.request.post("/api/workspace/topics", {
      data: {
        projectId: bootstrap.workspace.activeProjectId,
        label: `Real LLM sweep ${Date.now()}`,
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
    const uniqueDecision = `real LLM sweep ${Date.now()} keeps new judgment topics empty`;
    const messageId = randomUUID();
    const supabase = createSupabaseE2EClient();
    const { error: messageError } = await supabase.from("messages").insert({
      id: messageId,
      conversation_id: topicPayload.workspace.currentConversationId,
      topic_id: topicPayload.workspace.activeTopicId,
      project_id: topicPayload.workspace.activeProjectId,
      role: "user",
      content: `We decided ${uniqueDecision}. This is a durable implementation constraint for ZENO: new judgment topics must start with no inherited IR, and project-level unassigned candidates must wait for user assignment before confirmation.`,
      created_at: new Date().toISOString(),
    });
    expect(messageError).toBeNull();

    const sweepResponse = await page.request.post("/api/sweep/manual", {
      data: {
        project_id: topicPayload.workspace.activeProjectId,
        chat_session_id: topicPayload.workspace.currentConversationId,
        blocking: true,
      },
      timeout: 45_000,
    });
    expect(sweepResponse.ok()).toBeTruthy();
    const sweepPayload = (await sweepResponse.json()) as {
      status: string;
      candidates_created: number;
      ideas_created: number;
      model: string;
    };

    expect(sweepPayload.status).toBe("completed");
    expect(sweepPayload.model).not.toBe("heuristic-fallback");
    expect(sweepPayload.model).toBeTruthy();
    expect(
      sweepPayload.candidates_created + sweepPayload.ideas_created
    ).toBeGreaterThan(0);

    const pendingResponse = await page.request.get(
      `/api/ir?project_id=${topicPayload.workspace.activeProjectId}&topic_id=${topicPayload.workspace.activeTopicId}&status=pending`
    );
    expect(pendingResponse.ok()).toBeTruthy();
    const pending = (await pendingResponse.json()) as {
      nodes: Array<{
        title: string;
        content: string | null;
        sourceLayer: string;
      }>;
    };
    const serializedPending = JSON.stringify(pending.nodes).toLowerCase();

    expect(serializedPending).toContain("new judgment topics");
    expect(serializedPending).toContain("no inherited ir");
    expect(serializedPending).toContain("unassigned candidates");
    expect(serializedPending).toContain("sweep");
  });
});
