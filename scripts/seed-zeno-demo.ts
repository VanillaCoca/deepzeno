/**
 * One-off seed: a comprehensive demo project that exercises every truth-graph
 * feature (overview grouping, upstream chain, Truth/All stages, colors + dash
 * cues, open question, rejection, cross-stage edges, inline promote/confirm).
 *
 * Theme: ZENO's own product decisions.
 *
 * Run:  npx tsx scripts/seed-zeno-demo.ts
 * Safe to delete afterwards via the homepage project "⋯ → Delete project".
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const OWNER_EMAIL = "seanmingze@gmail.com";
const PROJECT_NAME = "ZENO Demo · Building ZENO";
const JUDGMENT_LABEL = "Building ZENO";

const PREFIX_MAP: Record<string, string> = {
  "goal:_": "G",
  "constraint:_": "C",
  "plan:decision": "D",
  "plan:task": "T",
  "plan:milestone": "M",
  "hypothesis:_": "H",
  "principle:_": "R",
  "open_question:_": "Q",
  "rejection:_": "X",
};

type Stage = "active" | "pending" | "idea";

type NodeSpec = {
  key: string;
  kind: string;
  subtype?: string | null;
  status: Stage;
  title: string;
  rationale: string;
  source: "manual" | "sweep";
  parentKey?: string;
};

// active = Truth · pending = Candidate · idea = Idea
const NODES: NodeSpec[] = [
  // ---- Truths (active) ----
  {
    key: "goal",
    kind: "goal",
    status: "active",
    title: "Make AI-era decisions reviewable and reusable",
    rationale:
      "Decisions made with AI should be inspectable later and reusable across conversations, not buried in chat history.",
    source: "manual",
  },
  {
    key: "readonly",
    kind: "constraint",
    status: "active",
    title: "Truth is read-only; edits happen in the sandbox",
    rationale:
      "Confirmed truths must be stable. Changes are explored in the sandbox and only promoted back when confirmed.",
    source: "manual",
  },
  {
    key: "principle",
    kind: "principle",
    status: "active",
    title: "AI never decides for the user — it only surfaces candidates",
    rationale:
      "ZENO proposes candidates and the user confirms. The human stays the decision-maker.",
    source: "manual",
  },
  {
    key: "onePane",
    kind: "plan",
    subtype: "decision",
    status: "active",
    title: "Use one continuous detail + action pane",
    rationale:
      "A single inspection surface keeps the graph, detail, and actions aligned instead of scattered panels.",
    source: "manual",
  },
  {
    key: "groupByTopic",
    kind: "plan",
    subtype: "decision",
    status: "active",
    title: "Group the overview by topic",
    rationale:
      "Topic containers give a stable spatial map so users build memory of where each truth lives.",
    source: "manual",
  },
  {
    key: "noChatLogs",
    kind: "rejection",
    status: "active",
    title: "Don't store full chat logs as truth",
    rationale:
      "Storing raw transcripts as truth is noisy and unreviewable; only store structured, confirmed judgments.",
    source: "manual",
  },
  {
    key: "recallQuestion",
    kind: "open_question",
    status: "active",
    title: "How to balance extraction recall vs precision?",
    rationale:
      "Aggressive extraction surfaces more candidates but adds noise; conservative extraction misses real decisions.",
    source: "sweep",
  },

  // ---- Candidates (pending) ----
  {
    key: "scopeToggle",
    kind: "plan",
    subtype: "decision",
    status: "pending",
    title: "Add a Truth/All scope toggle to the graph",
    rationale:
      "Let users switch between confirmed truths only and the full idea → candidate → truth pipeline in one graph.",
    source: "sweep",
  },
  {
    key: "accountMenu",
    kind: "plan",
    subtype: "decision",
    status: "pending",
    title: "ChatGPT-style account menu with theme toggle",
    rationale:
      "Move account actions into a popover with a working light/dark toggle, consistent with the header.",
    source: "sweep",
  },
  {
    key: "reviewGraphHypothesis",
    kind: "hypothesis",
    status: "pending",
    title: "A unified review graph speeds up promotion",
    rationale:
      "Seeing ideas, candidates, and truths together should make it faster to promote and confirm the right ones.",
    source: "sweep",
  },
  {
    key: "tuneThresholds",
    kind: "plan",
    subtype: "decision",
    status: "pending",
    title: "Tune sweep thresholds per project",
    rationale:
      "Per-project thresholds let teams pick their own recall/precision trade-off for extraction.",
    source: "sweep",
  },

  // ---- Ideas (idea) ----
  {
    key: "inlineSuggestions",
    kind: "plan",
    subtype: "decision",
    status: "idea",
    title: "Inline AI suggestions in the composer",
    rationale:
      "Surface candidate decisions inline as the user types, before a full sweep.",
    source: "sweep",
  },
  {
    key: "keyboardNav",
    kind: "plan",
    subtype: "decision",
    status: "idea",
    title: "Keyboard-only graph navigation",
    rationale:
      "Power users should be able to traverse and act on the graph without a mouse.",
    source: "sweep",
  },

  // ---- Sub-nodes (decompose a parent into smaller IRs) ----
  {
    key: "onePaneSharedHeader",
    kind: "plan",
    subtype: "task",
    status: "active",
    title: "Shared header over detail + actions",
    rationale:
      "One header (title + status) spanning the detail and action panes.",
    source: "manual",
    parentKey: "onePane",
  },
  {
    key: "toggleStageColors",
    kind: "plan",
    subtype: "task",
    status: "pending",
    title: "Stage color + dash encoding",
    rationale: "Truth/candidate/idea each get a distinct fill and glyph.",
    source: "sweep",
    parentKey: "scopeToggle",
  },
  {
    key: "toggleDrillIn",
    kind: "plan",
    subtype: "task",
    status: "idea",
    title: "Drill-in viewport for sub-nodes",
    rationale: "Focus a parent and show its children with a breadcrumb back.",
    source: "sweep",
    parentKey: "scopeToggle",
  },
];

// [fromKey, relation, toKey] — relation points child → parent (depends_on etc.).
const EDGES: [string, string, string][] = [
  ["onePane", "depends_on", "readonly"],
  ["groupByTopic", "depends_on", "goal"],
  ["recallQuestion", "depends_on", "goal"],
  ["noChatLogs", "refines", "readonly"],
  ["scopeToggle", "depends_on", "groupByTopic"], // candidate → truth (cross-stage)
  ["scopeToggle", "refines", "onePane"], // candidate → truth
  ["accountMenu", "refines", "onePane"], // candidate → truth
  ["reviewGraphHypothesis", "implies", "scopeToggle"], // candidate → candidate
  ["tuneThresholds", "resolves", "recallQuestion"], // candidate → truth (open question)
  ["inlineSuggestions", "refines", "principle"], // idea → truth (cross-stage)
  ["keyboardNav", "refines", "groupByTopic"], // idea → truth (cross-stage)
];

function prefixFor(kind: string, subtype?: string | null) {
  return PREFIX_MAP[`${kind}:${subtype ?? "_"}`] ?? "U";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!(url && serviceRoleKey)) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }

  const db = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Resolve the owner by email.
  const { data: userList, error: userErr } = await db.auth.admin.listUsers({
    perPage: 1000,
  });
  if (userErr) {
    throw userErr;
  }
  const owner = userList.users.find(
    (u) => u.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()
  );
  if (!owner) {
    throw new Error(`No auth user found for ${OWNER_EMAIL}`);
  }
  const userId = owner.id;
  const now = new Date().toISOString();

  // Closure over `db` so we avoid the supabase-js generic-typing friction of
  // passing the client as a parameter.
  const insertOne = async (
    table: string,
    payload: Record<string, unknown>,
    label: string
  ): Promise<{ id: string }> => {
    const { data, error } = await db
      .from(table)
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      throw new Error(`Failed to insert ${label}: ${error.message}`);
    }
    return data as { id: string };
  };

  // 2) Project skeleton: project + general topic + a conversation per topic.
  const project = await insertOne(
    "projects",
    { user_id: userId, name: PROJECT_NAME },
    "project"
  );

  const generalTopic = await insertOne(
    "topics",
    {
      project_id: project.id,
      label: "General",
      is_general: true,
      status: "exploring",
      position: 0,
    },
    "general topic"
  );
  await insertOne(
    "conversations",
    { topic_id: generalTopic.id, project_id: project.id },
    "general conversation"
  );

  const judgment = await insertOne(
    "topics",
    {
      project_id: project.id,
      label: JUDGMENT_LABEL,
      is_general: false,
      status: "exploring",
      position: 1,
    },
    "judgment topic"
  );
  await insertOne(
    "conversations",
    { topic_id: judgment.id, project_id: project.id },
    "judgment conversation"
  );

  // 3) IR nodes — ids continue the global per-prefix sequence (like the app).
  const prefixCounters: Record<string, number> = {};
  const idByKey: Record<string, string> = {};

  async function nextId(prefix: string) {
    if (prefixCounters[prefix] === undefined) {
      const { data, error } = await db
        .from("ir_nodes")
        .select("id")
        .like("id", `${prefix}%`);
      if (error) {
        throw error;
      }
      let max = 0;
      for (const row of data ?? []) {
        const match = String((row as { id: string }).id).match(
          new RegExp(`^${prefix}(\\d+)$`)
        );
        if (match) {
          max = Math.max(max, Number(match[1]));
        }
      }
      prefixCounters[prefix] = max;
    }
    prefixCounters[prefix] += 1;
    return `${prefix}${prefixCounters[prefix]}`;
  }

  for (const spec of NODES) {
    const id = await nextId(prefixFor(spec.kind, spec.subtype));
    idByKey[spec.key] = id;

    const row: Record<string, unknown> = {
      id,
      project_id: project.id,
      topic_id: judgment.id,
      parent_id: spec.parentKey ? idByKey[spec.parentKey] : null,
      kind: spec.kind,
      subtype: spec.subtype ?? null,
      status: spec.status,
      title: spec.title,
      content: spec.rationale,
      rationale: spec.rationale,
      sensitivity: "normal",
      source_layer: spec.source,
      created_by: "ai",
      created_at: now,
    };
    if (spec.status === "active") {
      row.confirmed_at = now;
    }
    if (spec.status === "pending") {
      row.promoted_to_pending_at = now;
    }

    const { error } = await db.from("ir_nodes").insert(row);
    if (error) {
      throw error;
    }
    console.log(`  node ${id}  [${spec.status}] ${spec.title}`);
  }

  // 4) IR edges (active so they render as confirmed relationships).
  const edgeRows = EDGES.map(([from, relation, to]) => ({
    project_id: project.id,
    from_node: idByKey[from],
    to_node: idByKey[to],
    relation,
    status: "active",
    is_anchor_hint: false,
  }));
  const { error: edgeErr } = await db.from("ir_edges").insert(edgeRows);
  if (edgeErr) {
    throw edgeErr;
  }

  console.log(
    `\nSeeded "${PROJECT_NAME}" (project ${project.id})\n` +
      `  ${NODES.length} nodes, ${EDGES.length} edges in judgment "${JUDGMENT_LABEL}".\n` +
      "Open it from the homepage, pick the judgment, then toggle Truth/All."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
