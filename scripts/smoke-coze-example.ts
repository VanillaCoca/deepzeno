/**
 * Live smoke test for the Coze Coding example: seed it into a borrowed
 * user's library, verify the graph, the seeded sandbox conversation, the
 * node→message provenance, and the research/watch artifacts, then delete
 * everything it created (including the chat rows, which project deletion
 * does not cascade to).
 *
 * Pre-migration databases are tolerated: the watch (and with it
 * next_directions) is expected to be skipped with a warning.
 *
 * Run:
 *   NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/smoke-coze-example.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const SLUG = "zh-coze-coding";

async function main() {
  const { getSupabaseAdminClient } = await import("../lib/supabase/admin");
  const { seedOneExampleProject } = await import(
    "../lib/workspace/example-projects"
  );
  const { EXAMPLE_PROJECTS } = await import("../lib/workspace/example-content");
  const { deleteProjectForUser, listProjectsByUserId } = await import(
    "../lib/workspace/queries"
  );

  // biome-ignore lint/suspicious/noExplicitAny: untyped admin client.
  const db = getSupabaseAdminClient() as any;

  const spec = EXAMPLE_PROJECTS.find((project) => project.slug === SLUG);
  if (!spec) {
    console.error(`spec "${SLUG}" not found`);
    process.exit(1);
  }

  const { data: anyProject } = await db
    .from("projects")
    .select("user_id")
    .limit(1)
    .maybeSingle();
  if (!anyProject) {
    console.error("No existing user to borrow.");
    process.exit(1);
  }
  const userId = String(anyProject.user_id);

  const before = new Set(
    (await listProjectsByUserId(userId)).map((p: { id: string }) => p.id)
  );

  // The allocator is module-private; seeding through the exported single-spec
  // entry point mirrors exactly what the backfill script does.
  const { getIRPrefix } = await import("../lib/ir/types");
  const counters = new Map<string, number>();
  const nextId = async (kind: string, subtype?: string) => {
    const prefix = getIRPrefix(kind as never, subtype as never);
    if (!counters.has(prefix)) {
      const { data } = await db
        .from("ir_nodes")
        .select("id")
        .like("id", `${prefix}%`);
      let max = 0;
      const pattern = new RegExp(`^${prefix}(\\d+)$`);
      for (const row of data ?? []) {
        const match = String(row.id).match(pattern);
        if (match) {
          max = Math.max(max, Number(match[1]));
        }
      }
      counters.set(prefix, max);
    }
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}${next}`;
  };

  const nowDate = new Date();
  await seedOneExampleProject({
    userId,
    spec,
    nextId: nextId as never,
    nowDate,
    nowIso: nowDate.toISOString(),
    variant: "official",
  });

  const after = await listProjectsByUserId(userId);
  const created = after.filter((p: { id: string }) => !before.has(p.id));
  const project = created.find((p: { name: string }) => p.name === spec.name);

  let failed = false;
  const check = (ok: boolean, label: string, detail?: unknown) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`, ok ? "" : (detail ?? ""));
    if (!ok) {
      failed = true;
    }
  };

  try {
    if (!project) {
      throw new Error("coze example was not seeded");
    }
    console.log("seeded project:", project.name, project.id);

    const { data: nodes } = await db
      .from("ir_nodes")
      .select("id,kind,status,source_layer,source_turn_id,source_chat_id")
      .eq("project_id", project.id);
    const { data: edges } = await db
      .from("ir_edges")
      .select("id,relation,label")
      .eq("project_id", project.id);

    check((nodes?.length ?? 0) >= 20, "nodes >= 20", nodes?.length);
    check((edges?.length ?? 0) >= 14, "edges >= 14", edges?.length);
    check(
      (edges ?? []).filter((e: { label: string | null }) => e.label).length >=
        10,
      "most edges carry an AI-written label"
    );
    check(
      (nodes ?? []).some(
        (n: { kind: string; status: string }) =>
          n.kind === "hypothesis" && n.status === "active"
      ),
      "has an active hypothesis (the watched premise)"
    );

    // Provenance: nodes distilled from the seeded conversation.
    const traced = (nodes ?? []).filter(
      (n: { source_turn_id: string | null }) => n.source_turn_id
    );
    check(traced.length >= 3, "3+ nodes carry source_turn_id", traced.length);

    const { data: workspaceMessages } = await db
      .from("messages")
      .select("id,role,content,created_at")
      .eq("project_id", project.id)
      .order("created_at", { ascending: true });
    const conversationTurns = (workspaceMessages ?? []).filter(
      (m: { content: string }) => !m.content.startsWith("👋")
    );
    check(
      conversationTurns.length >= 8,
      "sandbox conversation seeded (>=8 turns)",
      conversationTurns.length
    );

    const timestamps = conversationTurns.map((m: { created_at: string }) =>
      new Date(m.created_at).getTime()
    );
    check(
      timestamps.every(
        (t: number, i: number) => i === 0 || t > timestamps[i - 1]
      ),
      "conversation timestamps strictly ascending"
    );

    const chips = conversationTurns.filter((m: { content: string }) =>
      m.content.includes('<inline-ref id="')
    );
    check(chips.length >= 3, "3+ turns render an IR chip", chips.length);

    // Every chip must point at a node that actually exists.
    const nodeIds = new Set((nodes ?? []).map((n: { id: string }) => n.id));
    const referenced = new Set<string>();
    for (const message of conversationTurns) {
      for (const match of String(message.content).matchAll(
        /<inline-ref id="([^"]+)"\/>/g
      )) {
        referenced.add(match[1]);
      }
    }
    check(
      referenced.size > 0 && [...referenced].every((id) => nodeIds.has(id)),
      "every chip resolves to a seeded node",
      [...referenced]
    );

    // Each traced node's source_turn_id must be a real message id.
    const messageIds = new Set(
      (workspaceMessages ?? []).map((m: { id: string }) => m.id)
    );
    check(
      traced.every((n: { source_turn_id: string }) =>
        messageIds.has(n.source_turn_id)
      ),
      "source_turn_id points at a real message"
    );

    // Research artifacts.
    const { data: runs } = await db
      .from("research_run")
      .select("id,status,plan,run_type")
      .eq("project_id", project.id);
    check((runs?.length ?? 0) >= 2, "2+ research runs", runs?.length);
    check(
      (runs ?? []).every(
        (r: { plan: unknown }) => Array.isArray(r.plan) && r.plan.length > 0
      ),
      "every run persisted its plan (exploration board input)"
    );
    const patrolRun = (runs ?? []).find(
      (r: { run_type?: string }) => r.run_type === "patrol"
    );
    check(Boolean(patrolRun), "a patrol run exists (pre-migration: skipped)");

    const { data: evidence } = await db
      .from("evidence")
      .select("id,url,quote,stance")
      .eq("project_id", project.id);
    check((evidence?.length ?? 0) >= 3, "3+ evidence rows", evidence?.length);

    // select * so this works on both schema versions (next_directions is a
    // later migration; naming it explicitly would error the whole query).
    const { data: watches } = await db
      .from("ir_watches")
      .select("*")
      .eq("project_id", project.id);
    if (watches?.length) {
      check(watches[0].status === "active", "watch is active");
      const directions = watches[0].next_directions;
      if (directions === undefined) {
        console.log(
          "SKIP  next_directions check (20260719000001 migration pending)"
        );
      } else {
        check(
          Array.isArray(directions) && directions.length === 3,
          "watch carries 3 next_directions",
          directions
        );
      }
      check(
        (nodes ?? []).some(
          (n: { source_layer: string }) => n.source_layer === "watchtower"
        ),
        "watchtower alert candidate landed"
      );
    } else {
      console.log("SKIP  watch checks (watchtower migration pending)");
    }
  } catch (error) {
    failed = true;
    console.error("smoke failed:", error);
  } finally {
    for (const p of created) {
      // Chat rows are not covered by project deletion — remove them first
      // (Message_v2 → Chat) so the smoke leaves nothing behind.
      const { data: conversations } = await db
        .from("conversations")
        .select("id")
        .eq("project_id", p.id);
      for (const conversation of conversations ?? []) {
        await db.from("Message_v2").delete().eq("chatId", conversation.id);
        await db.from("Chat").delete().eq("id", conversation.id);
      }
      await deleteProjectForUser(p.id, userId);
    }
    console.log("cleaned up:", created.length, "project(s)");
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
