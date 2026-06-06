import { expect, type Page, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  createSupabaseE2EClient,
  deleteTestUser,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

async function ensureTopicLifecycleMigration() {
  if (!hasSupabaseE2EConfig) {
    return false;
  }

  const supabase = createSupabaseE2EClient();
  const topicResult = await supabase
    .from("topics")
    .select(
      "id,status,description,decided_at,executing_at,superseded_at,dismissed_at"
    )
    .limit(1);
  const relationResult = await supabase
    .from("topic_relations")
    .select("id")
    .limit(1);

  return !(topicResult.error || relationResult.error);
}

async function getActiveProjectId(page: Page) {
  const bootstrap = await page.request.get("/api/workspace/bootstrap");
  const payload = (await bootstrap.json()) as {
    workspace: { activeProjectId: string };
  };

  return payload.workspace.activeProjectId;
}

async function createJudgment(page: Page, projectId: string, label: string) {
  const response = await page.request.post("/api/workspace/topics", {
    data: { projectId, label },
  });
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as {
    workspace: { activeTopicId: string };
  };
  return payload.workspace.activeTopicId;
}

async function createPendingIR(
  page: Page,
  input: {
    projectId: string;
    topicId: string | null;
    title: string;
    relations?: Array<{ relation: string; to_node: string }>;
  }
) {
  const response = await page.request.post("/api/ir/draft", {
    data: {
      project_id: input.projectId,
      topic_id: input.topicId,
      kind: "plan",
      subtype: "decision",
      title: input.title,
      content: input.title,
      source_layer: "manual",
      created_by: "user",
      initial_status: "pending",
      relations: input.relations ?? [],
    },
  });
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as { node: { id: string } };
  return payload.node.id;
}

test.describe("Topic lifecycle IR model", () => {
  // biome-ignore lint/suspicious/noSkippedTests: conditional e2e requires Supabase auth.
  test.skip(!hasSupabaseE2EConfig, "Supabase auth must be configured.");

  let user: Awaited<ReturnType<typeof createConfirmedTestUser>> | null = null;

  test.beforeEach(async ({ page }) => {
    // biome-ignore lint/suspicious/noSkippedTests: migration is applied manually in shared Supabase.
    test.skip(
      !(await ensureTopicLifecycleMigration()),
      "Topic lifecycle migration is not applied."
    );

    user = await createConfirmedTestUser();
    await signInThroughLoginPage(page, user);
  });

  test.afterEach(async () => {
    if (user) {
      await deleteTestUser(user.id);
      user = null;
    }
  });

  test("new judgment starts with empty IR", async ({ page }) => {
    const projectId = await getActiveProjectId(page);
    const topicId = await createJudgment(
      page,
      projectId,
      `Empty judgment ${Date.now()}`
    );
    const response = await page.request.get(
      `/api/ir?project_id=${projectId}&topic_id=${topicId}&status=active`
    );
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ nodes: [] });
  });

  test("supersedes topic relation changes only the old topic lifecycle", async ({
    page,
  }) => {
    const projectId = await getActiveProjectId(page);
    const oldTopicId = await createJudgment(page, projectId, "Old judgment");
    const newTopicId = await createJudgment(page, projectId, "New judgment");
    const nodeId = await createPendingIR(page, {
      projectId,
      topicId: oldTopicId,
      title: "Old topic IR stays attached",
    });
    await page.request.post(`/api/ir/${nodeId}/confirm`);

    const relationResponse = await page.request.post(
      "/api/workspace/topic-relations",
      {
        data: {
          project_id: projectId,
          from_topic_id: newTopicId,
          to_topic_id: oldTopicId,
          relation_type: "supersedes",
        },
      }
    );
    expect(relationResponse.ok()).toBeTruthy();

    const supabase = createSupabaseE2EClient();
    const [{ data: oldTopic }, { data: oldNode }] = await Promise.all([
      supabase.from("topics").select("status").eq("id", oldTopicId).single(),
      supabase.from("ir_nodes").select("topic_id").eq("id", nodeId).single(),
    ]);

    expect(oldTopic?.status).toBe("superseded");
    expect(oldNode?.topic_id).toBe(oldTopicId);
  });

  test("IR relations can cross judgment topics within one project", async ({
    page,
  }) => {
    const projectId = await getActiveProjectId(page);
    const topicA = await createJudgment(page, projectId, "Use Supabase");
    const topicB = await createJudgment(page, projectId, "V1 mobile scope");
    const nodeA = await createPendingIR(page, {
      projectId,
      topicId: topicA,
      title: "Use Supabase for V1",
    });
    await page.request.post(`/api/ir/${nodeA}/confirm`);
    const nodeB = await createPendingIR(page, {
      projectId,
      topicId: topicB,
      title: "Mobile depends on backend shape",
      relations: [{ relation: "depends_on", to_node: nodeA }],
    });
    await page.request.post(`/api/ir/${nodeB}/confirm`);

    const detail = await page.request.get(`/api/ir/${nodeB}`);
    expect(detail.ok()).toBeTruthy();
    const payload = (await detail.json()) as {
      edges: Array<{ fromNode: string; toNode: string; relation: string }>;
    };
    expect(payload.edges).toContainEqual(
      expect.objectContaining({
        fromNode: nodeB,
        toNode: nodeA,
        relation: "depends_on",
      })
    );
  });

  test("unassigned candidate can create a new judgment on confirm", async ({
    page,
  }) => {
    const projectId = await getActiveProjectId(page);
    const nodeId = await createPendingIR(page, {
      projectId,
      topicId: null,
      title: "Unassigned seed becomes judgment truth",
    });
    const confirm = await page.request.post(`/api/ir/${nodeId}/confirm`, {
      data: { create_topic_label: "Should V1 add mobile?" },
    });
    expect(confirm.ok()).toBeTruthy();

    const supabase = createSupabaseE2EClient();
    const { data: node } = await supabase
      .from("ir_nodes")
      .select("status,topic_id")
      .eq("id", nodeId)
      .single();

    expect(node?.status).toBe("active");
    expect(node?.topic_id).toEqual(expect.any(String));
  });

  test("unassigned candidate can confirm into an existing judgment", async ({
    page,
  }) => {
    const projectId = await getActiveProjectId(page);
    const topicId = await createJudgment(
      page,
      projectId,
      "Existing assignment target"
    );
    const nodeId = await createPendingIR(page, {
      projectId,
      topicId: null,
      title: "Unassigned candidate joins existing topic",
    });
    const confirm = await page.request.post(`/api/ir/${nodeId}/confirm`, {
      data: { assign_to_topic_id: topicId },
    });
    expect(confirm.ok()).toBeTruthy();

    const supabase = createSupabaseE2EClient();
    const { data: node } = await supabase
      .from("ir_nodes")
      .select("status,topic_id")
      .eq("id", nodeId)
      .single();

    expect(node).toMatchObject({ status: "active", topic_id: topicId });
  });
});
