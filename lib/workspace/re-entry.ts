import "server-only";

import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProjectByIdForUser } from "@/lib/workspace/queries";
import {
  rankReEntryItems,
  type ReEntryItem,
} from "@/lib/workspace/re-entry-core";

type DatabaseRecord = Record<string, unknown>;

type DatabaseErrorLike = {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
};

// How many titled examples to carry back per category. The bar only ever shows
// the top one; the rest are there so the expanded card can name a few without a
// second round trip, and so a category whose top item was filtered out client
// side still has something to show.
const ITEMS_PER_CATEGORY = 3;

export type ProjectReEntrySnapshot = {
  absence_seconds: number | null;
  last_seen_at: string | null;
  since: {
    new_candidates: number;
    superseded_truth: number;
    unresolved_open_questions: number;
    mcp_writes: number;
  };
  /**
   * Consequence-ranked examples behind the counts. A count alone ("6 updates")
   * does not tell the user whether to care; the title of the single most
   * consequential change does.
   */
  items: ReEntryItem[];
};

function getClient(): any {
  return getSupabaseAdminClient() as any;
}

function isMissingTableError(error: DatabaseErrorLike | null | undefined) {
  return (
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table") === true ||
    error?.message?.includes("schema cache") === true
  );
}

async function ensureResult<T>(
  promise: PromiseLike<{ data: T; error: DatabaseErrorLike | null }>,
  message: string
) {
  const { data, error } = await promise;

  if (error) {
    console.error(message, {
      code: error.code ?? null,
      message: error.message,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
    throw new ChatbotError("bad_request:database", message);
  }

  return data;
}

async function countRows(
  promise: PromiseLike<{
    count: number | null;
    error: DatabaseErrorLike | null;
  }>,
  message: string
) {
  const { count, error } = await promise;

  if (error) {
    if (isMissingTableError(error)) {
      return 0;
    }

    console.error(message, {
      code: error.code ?? null,
      message: error.message,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
    throw new ChatbotError("bad_request:database", message);
  }

  return count ?? 0;
}

async function listRows<T>(
  promise: PromiseLike<{ data: T[] | null; error: DatabaseErrorLike | null }>,
  message: string
) {
  const { data, error } = await promise;

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    console.error(message, {
      code: error.code ?? null,
      message: error.message,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
    throw new ChatbotError("bad_request:database", message);
  }

  return data ?? [];
}

async function assertProjectAccess(userId: string, projectId: string) {
  const project = await getProjectByIdForUser(projectId, userId);

  if (!project) {
    throw new ChatbotError("forbidden:chat", "Project not found");
  }

  return project;
}

async function getMcpWriteCount(projectId: string, since: string) {
  const logRows = await listRows<DatabaseRecord>(
    getClient()
      .from("decision_log")
      .select("id, decision_id, candidate_id")
      .eq("actor_type", "external_agent")
      .gt("created_at", since),
    "Failed to load MCP write log"
  );

  if (logRows.length === 0) {
    return 0;
  }

  const decisionIds = [
    ...new Set(
      logRows
        .map((row) =>
          typeof row.decision_id === "string" ? row.decision_id : null
        )
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const candidateIds = [
    ...new Set(
      logRows
        .map((row) =>
          typeof row.candidate_id === "string" ? row.candidate_id : null
        )
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [decisionRows, candidateRows] = await Promise.all([
    decisionIds.length > 0
      ? listRows<DatabaseRecord>(
          getClient()
            .from("decisions")
            .select("id")
            .eq("project_id", projectId)
            .in("id", decisionIds),
          "Failed to load MCP write decisions"
        )
      : Promise.resolve([]),
    candidateIds.length > 0
      ? listRows<DatabaseRecord>(
          getClient()
            .from("candidate_decisions")
            .select("id")
            .eq("project_id", projectId)
            .in("id", candidateIds),
          "Failed to load MCP write candidates"
        )
      : Promise.resolve([]),
  ]);

  const projectDecisionIds = new Set(decisionRows.map((row) => String(row.id)));
  const projectCandidateIds = new Set(
    candidateRows.map((row) => String(row.id))
  );

  return logRows.filter((row) => {
    const decisionId =
      typeof row.decision_id === "string" ? row.decision_id : null;
    const candidateId =
      typeof row.candidate_id === "string" ? row.candidate_id : null;

    return (
      (decisionId ? projectDecisionIds.has(decisionId) : false) ||
      (candidateId ? projectCandidateIds.has(candidateId) : false)
    );
  }).length;
}

function firstString(row: DatabaseRecord, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function mapItems({
  category,
  rows,
  timeKeys,
  titleKeys,
}: {
  category: ReEntryItem["category"];
  rows: DatabaseRecord[];
  timeKeys: string[];
  titleKeys: string[];
}): ReEntryItem[] {
  const items: ReEntryItem[] = [];

  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : null;
    const title = firstString(row, titleKeys);
    const at = firstString(row, timeKeys);

    // An untitled row cannot be a headline — it would render as an empty
    // string, which reads as a bug. Drop it and let the counts carry it.
    if (!(id && title && at)) {
      continue;
    }

    items.push({ category, id, title, at });
  }

  return items;
}

/**
 * A legacy candidate written by an external agent is not a second update on top
 * of the candidate it created — it is the same row, seen from the angle the
 * user most needs. Classify by source so one row lands in exactly one category.
 */
function mapLegacyCandidateItems(rows: DatabaseRecord[]): ReEntryItem[] {
  const agentRows = rows.filter((row) => row.source === "mcp_agent");
  const ownRows = rows.filter((row) => row.source !== "mcp_agent");

  return [
    ...mapItems({
      category: "mcp_writes",
      rows: agentRows,
      timeKeys: ["created_at"],
      titleKeys: ["proposed_title", "proposed_content"],
    }),
    ...mapItems({
      category: "new_candidates",
      rows: ownRows,
      timeKeys: ["created_at"],
      titleKeys: ["proposed_title", "proposed_content"],
    }),
  ];
}

async function listReEntryItems(projectId: string, lastSeenAt: string) {
  const [
    supersededIr,
    supersededLegacy,
    pendingIr,
    pendingLegacy,
    openQuestionsIr,
    openQuestionsLegacy,
  ] = await Promise.all([
    listRows<DatabaseRecord>(
      getClient()
        .from("ir_nodes")
        .select("id, title, superseded_at")
        .eq("project_id", projectId)
        .eq("status", "superseded")
        .gt("superseded_at", lastSeenAt)
        .order("superseded_at", { ascending: false })
        .limit(ITEMS_PER_CATEGORY),
      "Failed to list superseded IR truth"
    ),
    listRows<DatabaseRecord>(
      getClient()
        .from("decisions")
        .select("id, title, updated_at")
        .eq("project_id", projectId)
        .eq("status", "superseded")
        .gt("updated_at", lastSeenAt)
        .order("updated_at", { ascending: false })
        .limit(ITEMS_PER_CATEGORY),
      "Failed to list superseded workspace truth"
    ),
    listRows<DatabaseRecord>(
      getClient()
        .from("ir_nodes")
        .select("id, title, created_at")
        .eq("project_id", projectId)
        .eq("status", "pending")
        .gt("created_at", lastSeenAt)
        .order("created_at", { ascending: false })
        .limit(ITEMS_PER_CATEGORY),
      "Failed to list new IR candidates"
    ),
    listRows<DatabaseRecord>(
      getClient()
        .from("candidate_decisions")
        .select("id, proposed_title, proposed_content, source, created_at")
        .eq("project_id", projectId)
        .eq("status", "pending")
        .gt("created_at", lastSeenAt)
        .order("created_at", { ascending: false })
        .limit(ITEMS_PER_CATEGORY * 2),
      "Failed to list new workspace candidates"
    ),
    listRows<DatabaseRecord>(
      getClient()
        .from("ir_nodes")
        .select("id, title, created_at")
        .eq("project_id", projectId)
        .eq("kind", "open_question")
        .eq("status", "active")
        .gt("created_at", lastSeenAt)
        .order("created_at", { ascending: false })
        .limit(ITEMS_PER_CATEGORY),
      "Failed to list unresolved IR open questions"
    ),
    listRows<DatabaseRecord>(
      getClient()
        .from("decisions")
        .select("id, title, created_at")
        .eq("project_id", projectId)
        .eq("kind", "open_question")
        .eq("status", "active")
        .gt("created_at", lastSeenAt)
        .order("created_at", { ascending: false })
        .limit(ITEMS_PER_CATEGORY),
      "Failed to list unresolved workspace open questions"
    ),
  ]);

  return rankReEntryItems([
    ...mapItems({
      category: "superseded_truth",
      rows: [...supersededIr, ...supersededLegacy],
      timeKeys: ["superseded_at", "updated_at"],
      titleKeys: ["title"],
    }),
    ...mapItems({
      category: "new_candidates",
      rows: pendingIr,
      timeKeys: ["created_at"],
      titleKeys: ["title"],
    }),
    ...mapLegacyCandidateItems(pendingLegacy),
    ...mapItems({
      category: "unresolved_open_questions",
      rows: [...openQuestionsIr, ...openQuestionsLegacy],
      timeKeys: ["created_at"],
      titleKeys: ["title"],
    }),
  ]);
}

export async function getProjectReEntrySnapshot({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}): Promise<ProjectReEntrySnapshot> {
  await assertProjectAccess(userId, projectId);

  const state = await ensureResult<DatabaseRecord | null>(
    getClient()
      .from("project_user_view_state")
      .select("last_seen_at")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .maybeSingle(),
    "Failed to load project view state"
  );

  if (!state?.last_seen_at) {
    return {
      absence_seconds: null,
      last_seen_at: null,
      since: {
        new_candidates: 0,
        superseded_truth: 0,
        unresolved_open_questions: 0,
        mcp_writes: 0,
      },
      items: [],
    };
  }

  const lastSeenAt = String(state.last_seen_at);
  const absenceSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000)
  );

  const [
    irPendingCandidates,
    legacyPendingCandidates,
    irSupersededTruth,
    legacySupersededTruth,
    irOpenQuestions,
    legacyOpenQuestions,
    mcpWrites,
    items,
  ] = await Promise.all([
    countRows(
      getClient()
        .from("ir_nodes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "pending")
        .gt("created_at", lastSeenAt),
      "Failed to count new IR candidates"
    ),
    countRows(
      getClient()
        .from("candidate_decisions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "pending")
        .gt("created_at", lastSeenAt),
      "Failed to count new workspace candidates"
    ),
    countRows(
      getClient()
        .from("ir_nodes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "superseded")
        .gt("superseded_at", lastSeenAt),
      "Failed to count superseded IR truth"
    ),
    countRows(
      getClient()
        .from("decisions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "superseded")
        .gt("updated_at", lastSeenAt),
      "Failed to count superseded workspace truth"
    ),
    countRows(
      getClient()
        .from("ir_nodes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("kind", "open_question")
        .eq("status", "active")
        .gt("created_at", lastSeenAt),
      "Failed to count unresolved IR open questions"
    ),
    countRows(
      getClient()
        .from("decisions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("kind", "open_question")
        .eq("status", "active")
        .gt("created_at", lastSeenAt),
      "Failed to count unresolved workspace open questions"
    ),
    getMcpWriteCount(projectId, lastSeenAt),
    listReEntryItems(projectId, lastSeenAt),
  ]);

  return {
    absence_seconds: absenceSeconds,
    last_seen_at: lastSeenAt,
    since: {
      new_candidates: irPendingCandidates + legacyPendingCandidates,
      superseded_truth: irSupersededTruth + legacySupersededTruth,
      unresolved_open_questions: irOpenQuestions + legacyOpenQuestions,
      mcp_writes: mcpWrites,
    },
    items,
  };
}

export async function markProjectSeenForUser({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}) {
  await assertProjectAccess(userId, projectId);

  const row = await ensureResult<DatabaseRecord>(
    getClient()
      .from("project_user_view_state")
      .upsert(
        {
          user_id: userId,
          project_id: projectId,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "user_id,project_id" }
      )
      .select("last_seen_at")
      .single(),
    "Failed to mark project view state"
  );

  return {
    last_seen_at:
      typeof row.last_seen_at === "string"
        ? row.last_seen_at
        : new Date().toISOString(),
  };
}
