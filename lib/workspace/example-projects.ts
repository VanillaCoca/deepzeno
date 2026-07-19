import "server-only";

import { saveChat, saveMessages } from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import type { IRKind, IRPlanSubtype } from "@/lib/ir/types";
import { getIRPrefix } from "@/lib/ir/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateUUID } from "@/lib/utils";
import type {
  ExampleConversationTurn,
  ExampleProject,
} from "./example-content";
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

// "official" is the showcase form (✦-prefixed name + welcome message);
// "personal" seeds the same graph as an ordinary working project.
export type ExampleVariant = "official" | "personal";

// One turn per minute, ending just before now, so the exchange reads as
// recent history and sorts strictly ascending in both message tables.
const TURN_SPACING_MS = 60_000;

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

// Seeds a multi-turn sandbox exchange into a topic's conversation, so the
// example shows the discussion its graph came out of. Returns turnIndex →
// messageId so nodes can point their provenance fields at the exact turn
// they were distilled from.
//
// Best-effort: this goes through the drizzle chat layer, and a failure here
// must not discard the graph. Returns an empty map on failure — nodes then
// seed without provenance, which is a degraded example, not a broken one.
async function seedTopicConversation({
  userId,
  projectId,
  topicId,
  conversationId,
  chatTitle,
  conversation,
  idByKey,
  endAt,
}: {
  userId: string;
  projectId: string;
  topicId: string;
  conversationId: string;
  chatTitle: string;
  conversation: ExampleConversationTurn[];
  idByKey: Map<string, string>;
  endAt: Date;
}): Promise<Map<number, string>> {
  const turnIds = new Map<number, string>();
  const startMs = endAt.getTime() - conversation.length * TURN_SPACING_MS;

  const chatMessages: Array<{
    id: string;
    chatId: string;
    role: string;
    parts: DBMessage["parts"];
    attachments: DBMessage["attachments"];
    createdAt: Date;
  }> = [];
  const workspaceMessages: Array<{
    id: string;
    conversationId: string;
    topicId: string;
    projectId: string;
    role: ExampleConversationTurn["role"];
    content: string;
    createdAt: string;
  }> = [];

  conversation.forEach((turn, index) => {
    const messageId = generateUUID();
    turnIds.set(index, messageId);
    const createdAt = new Date(startMs + index * TURN_SPACING_MS);
    // `{{ref:key}}` → the self-closing tag the chat renders as an IR chip.
    // An unknown key drops out rather than shipping a broken placeholder.
    const text = turn.text.replace(
      /\{\{ref:([a-zA-Z0-9_-]+)\}\}/g,
      (_match, key: string) => {
        const nodeId = idByKey.get(key);
        if (!nodeId) {
          console.warn(`[example-seed] unknown conversation ref "${key}"`);
          return "";
        }
        return `<inline-ref id="${nodeId}"/>`;
      }
    );

    chatMessages.push({
      id: messageId,
      chatId: conversationId,
      role: turn.role,
      parts: [{ type: "text", text }] as DBMessage["parts"],
      attachments: [] as DBMessage["attachments"],
      createdAt,
    });
    workspaceMessages.push({
      id: messageId,
      conversationId,
      topicId,
      projectId,
      role: turn.role,
      content: text,
      createdAt: createdAt.toISOString(),
    });
  });

  try {
    await saveChat({
      id: conversationId,
      userId,
      title: chatTitle,
      visibility: "private",
    });
    await saveMessages({ messages: chatMessages });
    await saveWorkspaceMessages(workspaceMessages);
    return turnIds;
  } catch (error) {
    console.error("[example-seed] conversation seeding failed", error);
    return new Map();
  }
}

// Inserts research runs + evidence, an active watch, and the watchtower
// alert candidate for the nodes an example declares research for. Each
// artifact class is individually tolerant: on a pre-watchtower-migration
// database the runs/evidence still land, the watch and alert are skipped.
async function seedResearchArtifacts({
  projectId,
  research,
  idByKey,
  topicIdByNodeKey,
  nextId,
  nowIso,
}: {
  projectId: string;
  research: NonNullable<ExampleProject["research"]>;
  idByKey: Map<string, string>;
  topicIdByNodeKey: Map<string, string>;
  nextId: NextIdFn;
  nowIso: string;
}) {
  const client = getClient();

  for (const entry of research) {
    const nodeId = idByKey.get(entry.nodeKey);
    const topicId = topicIdByNodeKey.get(entry.nodeKey) ?? null;
    if (!nodeId) {
      continue;
    }

    // 1. Runs + evidence (tables exist since the L2 migration).
    for (const run of entry.runs) {
      const runRowBase = {
        project_id: projectId,
        topic_id: topicId,
        origin_node_id: nodeId,
        plan: run.plan,
        brief: run.brief,
        status: "done",
        created_at: nowIso,
        finished_at: nowIso,
      };
      // run_type only exists post-watchtower-migration, and 'research' is the
      // column default — so only a patrol run needs to set it, and an older
      // database falls back to a plain research run rather than failing.
      let insert = await client
        .from("research_run")
        .insert(
          run.type === "patrol"
            ? { ...runRowBase, run_type: "patrol" }
            : runRowBase
        )
        .select("id")
        .single();
      if (insert.error && run.type === "patrol") {
        console.warn(
          "[example-seed] run_type unavailable; seeding patrol run as research",
          insert.error.message
        );
        insert = await client
          .from("research_run")
          .insert(runRowBase)
          .select("id")
          .single();
      }
      const { data: runRow, error: runError } = insert;
      if (runError) {
        throw runError;
      }

      const evidenceRows = run.evidence.map((item) => ({
        project_id: projectId,
        run_id: runRow.id,
        node_id: nodeId,
        url: item.url,
        title: item.title,
        quote: item.quote,
        claim: item.claim,
        stance: item.stance,
        source_score: item.url.includes(".canada.ca") ? 0.95 : 0.6,
        retrieved_at: nowIso,
        created_at: nowIso,
      }));
      if (evidenceRows.length > 0) {
        const { error: evidenceError } = await client
          .from("evidence")
          .insert(evidenceRows);
        if (evidenceError) {
          throw evidenceError;
        }
      }
    }

    // 2. Active watch (needs the watchtower migration; skip quietly without).
    if (entry.watch) {
      const watchRow = {
        project_id: projectId,
        node_id: nodeId,
        origin: "zeno_suggested",
        reason: entry.watch.reason,
        cadence: entry.watch.cadence,
        status: "active",
        last_patrol_at: nowIso,
        ...(entry.alert
          ? { last_signal_at: nowIso, last_alert_at: nowIso }
          : {}),
        next_due_at: new Date(
          new Date(nowIso).getTime() + 24 * 3600 * 1000
        ).toISOString(),
      };
      // next_directions arrived in a later migration (20260719000001). Retry
      // without it rather than losing the whole watch: the monitoring section,
      // the radar badge and the exploration board all still work, and the
      // board falls back to the run plan exactly as it does before a watch's
      // first patrol.
      let watchInsert = await client
        .from("ir_watches")
        .insert(
          entry.watch.nextDirections
            ? { ...watchRow, next_directions: entry.watch.nextDirections }
            : watchRow
        );
      if (watchInsert.error && entry.watch.nextDirections) {
        console.warn(
          "[example-seed] next_directions unavailable; seeding watch without it",
          watchInsert.error.message
        );
        watchInsert = await client.from("ir_watches").insert(watchRow);
      }
      const { error: watchError } = watchInsert;
      if (watchError) {
        console.warn(
          "[example-seed] watch skipped (watchtower migration pending?)",
          watchError.message
        );
      }
    }

    // 3. Alert candidate ('watchtower' source layer needs the migration's
    // widened check constraint; separate insert so failure stays local).
    if (entry.alert) {
      const alertId = await nextId("open_question");
      const { error: alertError } = await client.from("ir_nodes").insert({
        id: alertId,
        project_id: projectId,
        topic_id: topicId,
        kind: "open_question",
        subtype: null,
        status: "pending",
        title: entry.alert.title,
        content: entry.alert.rationale,
        rationale: entry.alert.rationale,
        sensitivity: "normal",
        source_layer: "watchtower",
        created_by: "ai",
        created_at: nowIso,
        promoted_to_pending_at: nowIso,
      });
      if (alertError) {
        console.warn(
          "[example-seed] alert candidate skipped (watchtower migration pending?)",
          alertError.message
        );
      } else {
        const { error: alertEdgeError } = await client.from("ir_edges").insert({
          project_id: projectId,
          from_node: alertId,
          to_node: nodeId,
          relation: "contradicts",
          label: entry.alert.edgeLabel,
          status: "active",
          is_anchor_hint: false,
        });
        if (alertEdgeError) {
          console.warn(
            "[example-seed] alert edge skipped",
            alertEdgeError.message
          );
        }
      }
    }
  }
}

// Exported for the one-off backfill script, which seeds a single spec (and
// the personal variant) into existing users rather than the whole set.
export async function seedOneExampleProject({
  userId,
  userEmail,
  spec,
  nextId,
  nowDate,
  nowIso,
  variant = "official",
}: SeedArgs & {
  spec: ExampleProject;
  nextId: NextIdFn;
  nowDate: Date;
  nowIso: string;
  variant?: ExampleVariant;
}) {
  const client = getClient();
  const projectName =
    variant === "personal" ? (spec.personalName ?? spec.name) : spec.name;
  const project = await createProjectForUser({
    userId,
    userEmail,
    name: projectName,
  });

  // Create topics (in declared order → positions) and a conversation each.
  const createdTopics: Array<{
    key: string;
    topicId: string;
    conversationId: string;
    nodes: ExampleProject["topics"][number]["nodes"];
    edges: ExampleProject["topics"][number]["edges"];
    conversation?: ExampleConversationTurn[];
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
      conversation: topic.conversation,
    });
  }

  // Ids first: the conversation's {{ref:}} placeholders need them, and the
  // node rows need the message ids the conversation returns. Two passes, so
  // each side can point at the other.
  const idByKey = new Map<string, string>();
  const topicIdByNodeKey = new Map<string, string>();

  for (const topic of createdTopics) {
    for (const node of topic.nodes) {
      const id = await nextId(node.kind, node.subtype);
      idByKey.set(node.key, id);
      topicIdByNodeKey.set(node.key, topic.topicId);
    }
  }

  // Conversations before nodes, so provenance can reference real message ids.
  const turnIdsByTopicKey = new Map<string, Map<number, string>>();
  for (const topic of createdTopics) {
    if (!topic.conversation || topic.conversation.length === 0) {
      continue;
    }
    const turnIds = await seedTopicConversation({
      userId,
      projectId: project.id,
      topicId: topic.topicId,
      conversationId: topic.conversationId,
      chatTitle: projectName,
      conversation: topic.conversation,
      idByKey,
      endAt: nowDate,
    });
    turnIdsByTopicKey.set(topic.key, turnIds);
  }

  const nodeRows: Record<string, unknown>[] = [];
  for (const topic of createdTopics) {
    const turnIds = turnIdsByTopicKey.get(topic.key);
    for (const node of topic.nodes) {
      const sourceTurnId =
        node.sourceTurnIndex === undefined
          ? undefined
          : turnIds?.get(node.sourceTurnIndex);
      nodeRows.push({
        id: idByKey.get(node.key),
        project_id: project.id,
        topic_id: topic.topicId,
        kind: node.kind,
        subtype: node.subtype ?? null,
        status: node.status,
        title: node.title,
        content: node.rationale,
        rationale: node.rationale,
        sensitivity: "normal",
        source_layer:
          node.sourceLayer ?? (node.status === "active" ? "manual" : "sweep"),
        created_by: "ai",
        created_at: nowIso,
        // Provenance back to the exchange this judgment came from — the same
        // columns the live inline-marker path writes.
        ...(sourceTurnId
          ? {
              source_chat_id: topic.conversationId,
              source_turn_id: sourceTurnId,
              source_text_span: node.sourceSpan ?? null,
            }
          : {}),
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
        label: edge.label ?? null,
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

  // Pre-baked research/watch/alert artifacts — the "agent already did its
  // homework" moment on first open. Strictly best-effort: a database that
  // hasn't run the watchtower migration yet (ir_watches table, 'watchtower'
  // source layer) still seeds the full graph above.
  if (spec.research && spec.research.length > 0) {
    try {
      await seedResearchArtifacts({
        projectId: project.id,
        research: spec.research,
        idByKey,
        topicIdByNodeKey,
        nextId,
        nowIso,
      });
    } catch (error) {
      console.error(
        `[example-seed] research artifacts failed for "${spec.slug}" (graph seeded)`,
        error
      );
    }
  }

  // The personal variant is meant to read as a real working project, so it
  // skips the official welcome message entirely.
  const landing =
    variant === "personal"
      ? null
      : (createdTopics.find((topic) => topic.key === spec.welcomeTopicKey) ??
        createdTopics[0]);
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
        projectName,
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
