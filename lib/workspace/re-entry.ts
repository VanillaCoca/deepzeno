import "server-only";

import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

type DatabaseRecord = Record<string, unknown>;

type DatabaseErrorLike = {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
};

export type ProjectReEntrySnapshot = {
  absence_seconds: number | null;
  last_seen_at: string | null;
  since: {
    new_candidates: number;
    superseded_truth: number;
    unresolved_open_questions: number;
    mcp_writes: number;
  };
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
