import "server-only";

import { saveChat, saveMessages } from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import type { IRKind, IRPlanSubtype } from "@/lib/ir/types";
import { getIRPrefix } from "@/lib/ir/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateUUID } from "@/lib/utils";
import type { ExampleProject } from "./example-content";
import { EXAMPLE_PROJECTS } from "./example-content";
import {
  createConversation,
  createProjectForUser,
  createTopicForProject,
  listProjectsByUserId,
  saveWorkspaceMessages,
} from "./queries";

// Seeds the two official example projects (English + Chinese) into a new user's
// Library. See docs/superpowers/specs/2026-07-07-example-projects-seeding-design.md.
//
// Skeleton rows (project/topic/conversation) go through the tested workspace
// helpers; ir_nodes/ir_edges go straight through the service-role admin client
// because that is the only path that can seed `active` truths and `pending`
// candidates directly (createIRNodeForUser is pending/idea only). Direct INSERTs
// are exempt from the ir status-transition trigger.

type SeedArgs = { userId: string; userEmail?: string | null };

type NextIdFn = (kind: IRKind, subtype?: IRPlanSubtype) => Promise<string>;

// The service-role admin client, typed as `any` to match lib/workspace/queries.ts:
// the untyped supabase-js client types table rows as `never`, which otherwise
// rejects dynamic insert payloads.
function getClient(): any {
  return getSupabaseAdminClient();
}

// Continues the global per-prefix ir_nodes id sequence (G/C/D/T/M/H/R/Q/X),
// exactly like scripts/seed-zeno-demo.ts. One allocator is shared across both
// example projects so their generated ids never collide.
function createIdAllocator(): NextIdFn {
  const client = getClient();
  const counters = new Map<string, number>();

  return async (kind, subtype) => {
    const prefix = getIRPrefix(kind, subtype);

    if (!counters.has(prefix)) {
      const { data, error } = await client
        .from("ir_nodes")
        .select("id")
        .like("id", `${prefix}%`);
      if (error) {
        throw error;
      }

      let max = 0;
      const pattern = new RegExp(`^${prefix}(\\d+)$`);
      for (const row of data ?? []) {
        const match = String((row as { id: string }).id).match(pattern);
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
}

async function seedWelcomeMessage({
  userId,
  projectId,
  topicId,
  conversationId,
  projectName,
  content,
  nowDate,
  nowIso,
}: {
  userId: string;
  projectId: string;
  topicId: string;
  conversationId: string;
  projectName: string;
  content: string;
  nowDate: Date;
  nowIso: string;
}) {
  const messageId = generateUUID();

  // Same triad as seedKickoffIntake: Chat row first (Message_v2.chatId FK), then
  // the chat message, then the workspace message the chat UI reads.
  await saveChat({
    id: conversationId,
    userId,
    title: projectName,
    visibility: "private",
  });
  await saveMessages({
    messages: [
      {
        id: messageId,
        chatId: conversationId,
        role: "assistant",
        parts: [{ type: "text", text: content }] as DBMessage["parts"],
        attachments: [] as DBMessage["attachments"],
        createdAt: nowDate,
      },
    ],
  });
  await saveWorkspaceMessages([
    {
      id: messageId,
      conversationId,
      topicId,
      projectId,
      role: "assistant",
      content,
      createdAt: nowIso,
    },
  ]);
}

async function seedOneExampleProject({
  userId,
  userEmail,
  spec,
  nextId,
  nowDate,
  nowIso,
}: SeedArgs & {
  spec: ExampleProject;
  nextId: NextIdFn;
  nowDate: Date;
  nowIso: string;
}) {
  const client = getClient();
  const project = await createProjectForUser({
    userId,
    userEmail,
    name: spec.name,
  });

  // Create topics (in declared order → positions) and a conversation each.
  const createdTopics: Array<{
    key: string;
    topicId: string;
    conversationId: string;
    nodes: ExampleProject["topics"][number]["nodes"];
    edges: ExampleProject["topics"][number]["edges"];
  }> = [];

  for (const [index, topic] of spec.topics.entries()) {
    const createdTopic = await createTopicForProject({
      projectId: project.id,
      label: topic.label,
      isGeneral: topic.isGeneral ?? false,
      position: index,
    });
    const conversation = await createConversation({
      topicId: createdTopic.id,
      projectId: project.id,
    });
    createdTopics.push({
      key: topic.key,
      topicId: createdTopic.id,
      conversationId: conversation.id,
      nodes: topic.nodes,
      edges: topic.edges,
    });
  }

  // Assign ids to every node, then bulk-insert nodes, then edges.
  const idByKey = new Map<string, string>();
  const nodeRows: Record<string, unknown>[] = [];

  for (const topic of createdTopics) {
    for (const node of topic.nodes) {
      const id = await nextId(node.kind, node.subtype);
      idByKey.set(node.key, id);
      nodeRows.push({
        id,
        project_id: project.id,
        topic_id: topic.topicId,
        kind: node.kind,
        subtype: node.subtype ?? null,
        status: node.status,
        title: node.title,
        content: node.rationale,
        rationale: node.rationale,
        sensitivity: "normal",
        source_layer: node.status === "active" ? "manual" : "sweep",
        created_by: "ai",
        created_at: nowIso,
        ...(node.status === "active" ? { confirmed_at: nowIso } : {}),
        ...(node.status === "pending"
          ? { promoted_to_pending_at: nowIso }
          : {}),
      });
    }
  }

  if (nodeRows.length > 0) {
    const { error } = await client.from("ir_nodes").insert(nodeRows);
    if (error) {
      throw error;
    }
  }

  const edgeRows: Record<string, unknown>[] = [];
  for (const topic of createdTopics) {
    for (const edge of topic.edges) {
      const fromId = idByKey.get(edge.from);
      const toId = idByKey.get(edge.to);
      if (!(fromId && toId)) {
        continue;
      }
      edgeRows.push({
        project_id: project.id,
        from_node: fromId,
        to_node: toId,
        relation: edge.relation,
        status: "active",
        is_anchor_hint: false,
      });
    }
  }

  if (edgeRows.length > 0) {
    const { error } = await client.from("ir_edges").insert(edgeRows);
    if (error) {
      throw error;
    }
  }

  const landing =
    createdTopics.find((topic) => topic.key === spec.welcomeTopicKey) ??
    createdTopics[0];
  if (landing) {
    // Best-effort: the graph is the valuable part. A failure seeding the
    // welcome message (which goes through the drizzle chat layer) must not
    // discard the project + graph already inserted above.
    try {
      await seedWelcomeMessage({
        userId,
        projectId: project.id,
        topicId: landing.topicId,
        conversationId: landing.conversationId,
        projectName: spec.name,
        content: spec.welcome,
        nowDate,
        nowIso,
      });
    } catch (error) {
      console.error(
        `[example-seed] welcome message failed for "${spec.slug}" (graph seeded)`,
        error
      );
    }
  }
}

// Seeds both example projects. Callers should prefer ensureExampleProjectsSeeded,
// which guards on emptiness and never throws.
export async function seedExampleProjectsForUser({
  userId,
  userEmail,
}: SeedArgs) {
  const nextId = createIdAllocator();
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();

  for (const spec of EXAMPLE_PROJECTS) {
    // Isolate each project so one failing to seed doesn't prevent the other.
    try {
      await seedOneExampleProject({
        userId,
        userEmail,
        spec,
        nextId,
        nowDate,
        nowIso,
      });
    } catch (error) {
      console.error(`[example-seed] failed to seed "${spec.slug}"`, error);
    }
  }
}

// Idempotent, non-throwing entry point. Seeds the examples only when the user
// has zero projects, and swallows any failure so a seed error can never block
// login or the Library from rendering.
export async function ensureExampleProjectsSeeded({
  userId,
  userEmail,
}: SeedArgs) {
  try {
    const existing = await listProjectsByUserId(userId);
    if (existing.length > 0) {
      return;
    }
    await seedExampleProjectsForUser({ userId, userEmail });
  } catch (error) {
    console.error("[example-seed] failed to seed example projects", error);
  }
}
