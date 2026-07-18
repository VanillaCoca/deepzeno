/**
 * Live smoke test: one full Watchtower patrol, end to end and self-cleaning.
 *
 * Search + page fetch run on the local fixtures (tests/fixtures/research —
 * no web keys needed); the LLM stages run on the REAL DeepSeek API. Expects
 * the fixture "policy tightened" page to trigger a new_contradiction signal
 * and land one pending open_question alert (sourceLayer "watchtower").
 *
 * Creates a temp project + hypothesis + watch, and deletes them afterwards.
 *
 * Run:
 *   NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/smoke-patrol.ts
 *
 * Exit codes: 0 = pass · 1 = fail · 2 = watchtower migration not applied yet.
 */
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });
process.env.ZENO_SEARCH_FIXTURES_DIR = join(
  process.cwd(),
  "tests",
  "fixtures",
  "research"
);

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY missing — cannot smoke-test the patrol.");
    process.exit(1);
  }

  const { getSupabaseAdminClient } = await import("../lib/supabase/admin");
  const { createIRNodeForUser } = await import("../lib/ir/queries");
  const { createWatch } = await import("../lib/research/watch-queries");
  const { runPatrolForWatch } = await import("../lib/research/patrol");
  const { IRNotReadyError } = await import("../lib/ir/queries");

  // biome-ignore lint/suspicious/noExplicitAny: untyped admin client.
  const db = getSupabaseAdminClient() as any;

  // Borrow an existing user id (any project owner) — auth.users is not
  // directly insertable and the smoke test must not create accounts.
  const { data: anyProject } = await db
    .from("projects")
    .select("user_id")
    .limit(1)
    .maybeSingle();
  if (!anyProject) {
    console.error("No existing project/user found to borrow an owner from.");
    process.exit(1);
  }
  const ownerId = String(anyProject.user_id);

  const { data: projectRow, error: projectError } = await db
    .from("projects")
    .insert({ user_id: ownerId, name: "[smoke] watchtower patrol" })
    .select("id")
    .single();
  if (projectError) {
    console.error("Failed to create temp project:", projectError.message);
    process.exit(1);
  }
  const projectId = String(projectRow.id);

  const cleanup = async () => {
    // Reverse-order, best-effort. FKs from evidence/research_run/ir_watches
    // to the project cascade, but ir_nodes ids are text and referenced by
    // evidence — delete children first to be safe.
    for (const [table, column] of [
      ["evidence", "project_id"],
      ["research_run", "project_id"],
      ["ir_watches", "project_id"],
      ["ir_edges", "project_id"],
      ["ir_nodes", "project_id"],
      ["projects", "id"],
    ] as const) {
      await db.from(table).delete().eq(column, projectId);
    }
  };

  try {
    const node = await createIRNodeForUser({
      userId: ownerId,
      projectId,
      topicId: null,
      kind: "hypothesis",
      title: "假设:加拿大联邦技术移民(Express Entry)政策未来 12 个月不会收紧",
      rationale: "整条移民路径决策建立在该前提上。",
      sourceLayer: "manual",
      createdBy: "user",
      initialStatus: "pending",
    });
    console.log("created node:", node.id);

    let watchId: string;
    try {
      const watch = await createWatch({
        projectId,
        nodeId: node.id,
        origin: "zeno_suggested",
        reason: "smoke test",
        cadence: "daily",
      });
      watchId = watch.id;
    } catch (error) {
      if (error instanceof IRNotReadyError) {
        console.error(
          "SKIP: ir_watches table missing — apply supabase/migrations/20260718000001_watchtower.sql in the Supabase SQL editor first."
        );
        await cleanup();
        process.exit(2);
      }
      throw error;
    }
    console.log("created watch:", watchId);

    const result = await runPatrolForWatch({ watchId });
    console.log("patrol result:", JSON.stringify(result));

    const { data: alerts } = await db
      .from("ir_nodes")
      .select("id,title,source_layer,status")
      .eq("project_id", projectId)
      .eq("source_layer", "watchtower");
    console.log("alert nodes:", JSON.stringify(alerts));

    if (result.status !== "signal_alerted" || !alerts || alerts.length !== 1) {
      console.error(
        "FAIL: expected one watchtower alert from the contradicting fixture page."
      );
      await cleanup();
      process.exit(1);
    }

    console.log(
      "PASS: patrol detected the policy change and landed an alert candidate."
    );
  } finally {
    await cleanup();
    console.log("cleaned up temp project", projectId);
  }
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exit(1);
});
