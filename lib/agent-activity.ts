import "server-only";

import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getProjectByIdForUser,
  mapCandidate,
  mapDecision,
} from "@/lib/workspace/queries";
import type {
  WorkspaceCandidateDecision,
  WorkspaceDecision,
} from "@/lib/workspace/types";

type DatabaseRecord = Record<string, unknown>;

type AgentActivityAction =
  | "create"
  | "update"
  | "archive"
  | "supersede"
  | "create_edge"
  | "delete_edge"
  | "candidate_submitted";

export type AgentActivityItem = {
  log_id: string;
  created_at: string;
  agent: string;
  session_id: string | null;
  tool: string | null;
  action: string;
  decision: WorkspaceDecision | null;
  candidate: WorkspaceCandidateDecision | null;
  metadata: Record<string, unknown>;
  revertable: boolean;
};

export class AgentActivityConflictError extends Error {
  currentState: unknown;

  constructor(message: string, currentState: unknown) {
    super(message);
    this.name = "AgentActivityConflictError";
    this.currentState = currentState;
  }
}

function getClient(): any {
  return getSupabaseAdminClient() as any;
}

function toIsoString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstNestedRecord(value: unknown): DatabaseRecord | null {
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object"
      ? (value[0] as DatabaseRecord)
      : null;
  }

  return value && typeof value === "object" ? (value as DatabaseRecord) : null;
}

function getNestedDecision(row: DatabaseRecord) {
  const nested = firstNestedRecord(row.decisions);
  return nested ? mapDecision(nested) : null;
}

function getNestedCandidate(row: DatabaseRecord) {
  const nested = firstNestedRecord(row.candidate_decisions);
  return nested ? mapCandidate(nested) : null;
}

function getMetadataString(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function isRevertableAction(action: string): action is AgentActivityAction {
  return [
    "create",
    "update",
    "archive",
    "supersede",
    "create_edge",
    "delete_edge",
  ].includes(action);
}

function mapActivityRow(row: DatabaseRecord): AgentActivityItem {
  const metadata = asRecord(row.metadata);
  const action = String(row.action);

  return {
    log_id: String(row.id),
    created_at: toIsoString(row.created_at),
    agent: getMetadataString(metadata, "agent") ?? "unknown",
    session_id: getMetadataString(metadata, "session_id"),
    tool: getMetadataString(metadata, "tool"),
    action,
    decision: getNestedDecision(row),
    candidate: getNestedCandidate(row),
    metadata,
    revertable: isRevertableAction(action),
  };
}

async function ensureOwnedProject(projectId: string, userId: string) {
  const project = await getProjectByIdForUser(projectId, userId);

  if (!project) {
    throw new ChatbotError("forbidden:chat", "Project not found");
  }

  return project;
}

export async function listAgentActivityForUser({
  userId,
  projectId,
  cursor,
  limit = 50,
}: {
  userId: string;
  projectId: string;
  cursor?: string | null;
  limit?: number;
}) {
  await ensureOwnedProject(projectId, userId);

  const client = getClient();
  const pageSize = Math.min(Math.max(limit, 1), 50);

  let decisionQuery = client
    .from("decision_log")
    .select("*, decisions!inner(*)")
    .eq("actor_type", "external_agent")
    .eq("decisions.project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);

  let candidateQuery = client
    .from("decision_log")
    .select("*, candidate_decisions!inner(*)")
    .eq("actor_type", "external_agent")
    .eq("candidate_decisions.project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);

  if (cursor) {
    decisionQuery = decisionQuery.lt("created_at", cursor);
    candidateQuery = candidateQuery.lt("created_at", cursor);
  }

  const [decisionResult, candidateResult] = await Promise.all([
    decisionQuery,
    candidateQuery,
  ]);

  if (decisionResult.error || candidateResult.error) {
    console.error("Failed to list agent activity", {
      decisionError: decisionResult.error ?? null,
      candidateError: candidateResult.error ?? null,
    });
    throw new ChatbotError(
      "bad_request:database",
      "Failed to list agent activity"
    );
  }

  const byId = new Map<string, AgentActivityItem>();

  for (const row of (decisionResult.data ?? []) as DatabaseRecord[]) {
    const item = mapActivityRow(row);
    byId.set(item.log_id, item);
  }

  for (const row of (candidateResult.data ?? []) as DatabaseRecord[]) {
    const item = mapActivityRow(row);
    byId.set(item.log_id, {
      ...byId.get(item.log_id),
      ...item,
      decision: byId.get(item.log_id)?.decision ?? item.decision,
      candidate: item.candidate ?? byId.get(item.log_id)?.candidate ?? null,
    });
  }

  const sorted = [...byId.values()].sort((left, right) =>
    right.created_at.localeCompare(left.created_at)
  );
  const items = sorted.slice(0, pageSize);
  const nextCursor = sorted.length > pageSize ? items.at(-1)?.created_at : null;

  return {
    items,
    next_cursor: nextCursor ?? null,
  };
}

async function getDecisionById(decisionId: string) {
  const client = getClient();
  const { data, error } = await client
    .from("decisions")
    .select("*")
    .eq("id", decisionId)
    .maybeSingle();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to load decision");
  }

  return data ? mapDecision(data as DatabaseRecord) : null;
}

async function getCandidateById(candidateId: string) {
  const client = getClient();
  const { data, error } = await client
    .from("candidate_decisions")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to load candidate");
  }

  return data ? mapCandidate(data as DatabaseRecord) : null;
}

async function updateDecisionRecord(
  decisionId: string,
  patch: Record<string, unknown>
) {
  const client = getClient();
  const { data, error } = await client
    .from("decisions")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", decisionId)
    .select("*")
    .single();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to update decision");
  }

  return mapDecision(data as DatabaseRecord);
}

async function getEdgeById(edgeId: string) {
  const client = getClient();
  const { data, error } = await client
    .from("edges")
    .select("*")
    .eq("id", edgeId)
    .maybeSingle();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to load edge");
  }

  return data ? (data as DatabaseRecord) : null;
}

async function deleteEdgeById(edgeId: string) {
  const client = getClient();
  const { error } = await client.from("edges").delete().eq("id", edgeId);

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to delete edge");
  }
}

async function findMatchingEdge(edge: DatabaseRecord) {
  const client = getClient();
  const { data, error } = await client
    .from("edges")
    .select("*")
    .eq("project_id", String(edge.project_id))
    .eq("topic_id", String(edge.topic_id))
    .eq("source_decision_id", String(edge.source_decision_id))
    .eq("target_decision_id", String(edge.target_decision_id))
    .eq("type", String(edge.type))
    .maybeSingle();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to inspect edge");
  }

  return data ? (data as DatabaseRecord) : null;
}

async function insertEdge(edge: DatabaseRecord) {
  const client = getClient();
  const { data, error } = await client
    .from("edges")
    .insert({
      project_id: edge.project_id,
      topic_id: edge.topic_id,
      source_decision_id: edge.source_decision_id,
      target_decision_id: edge.target_decision_id,
      type: edge.type,
    })
    .select("*")
    .single();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to insert edge");
  }

  return data as DatabaseRecord;
}

function pickDecisionPatch(snapshot: unknown) {
  const decision = asRecord(snapshot);

  return {
    title: decision.title,
    content: decision.content,
    rationale: decision.rationale ?? null,
    kind: decision.kind,
    weight: decision.weight,
    status: decision.status,
    code_anchors: decision.codeAnchors ?? decision.code_anchors ?? null,
  };
}

function decisionMatches(
  decision: WorkspaceDecision,
  snapshot: unknown
): snapshot is WorkspaceDecision {
  const expected = asRecord(snapshot);

  return (
    decision.title === expected.title &&
    decision.content === expected.content &&
    decision.rationale === (expected.rationale ?? null) &&
    decision.kind === expected.kind &&
    decision.weight === expected.weight &&
    decision.status === expected.status &&
    JSON.stringify(decision.codeAnchors ?? null) ===
      JSON.stringify(expected.codeAnchors ?? expected.code_anchors ?? null)
  );
}

async function insertRevertLog({
  decisionId,
  candidateId,
  originalLogId,
  action,
  metadata,
}: {
  decisionId?: string | null;
  candidateId?: string | null;
  originalLogId: string;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  const client = getClient();
  const { data, error } = await client
    .from("decision_log")
    .insert({
      decision_id: decisionId ?? null,
      candidate_id: candidateId ?? null,
      action: "revert",
      actor_type: "user",
      metadata: {
        original_log_id: originalLogId,
        reverted_action: action,
        ...(metadata ?? {}),
      },
    })
    .select("id")
    .single();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to insert revert log"
    );
  }

  return String((data as DatabaseRecord).id);
}

async function loadActivityLog(logId: string) {
  const client = getClient();
  const { data, error } = await client
    .from("decision_log")
    .select("*")
    .eq("id", logId)
    .maybeSingle();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to load activity log"
    );
  }

  if (!data) {
    throw new ChatbotError("not_found:chat", "Activity log not found");
  }

  return data as DatabaseRecord;
}

async function ensureLogInProject(log: DatabaseRecord, projectId: string) {
  const decisionId = typeof log.decision_id === "string" ? log.decision_id : "";
  const candidateId =
    typeof log.candidate_id === "string" ? log.candidate_id : "";

  if (decisionId) {
    const decision = await getDecisionById(decisionId);

    if (!decision || decision.projectId !== projectId) {
      throw new ChatbotError("forbidden:chat", "Activity is not in project");
    }

    return { decision, candidate: null };
  }

  if (candidateId) {
    const candidate = await getCandidateById(candidateId);

    if (!candidate || candidate.projectId !== projectId) {
      throw new ChatbotError("forbidden:chat", "Activity is not in project");
    }

    return { decision: null, candidate };
  }

  throw new ChatbotError("bad_request:api", "Activity is missing target");
}

export async function revertAgentActivityForUser({
  userId,
  projectId,
  logId,
}: {
  userId: string;
  projectId: string;
  logId: string;
}) {
  await ensureOwnedProject(projectId, userId);

  const log = await loadActivityLog(logId);
  const action = String(log.action);
  const metadata = asRecord(log.metadata);
  const targets = await ensureLogInProject(log, projectId);

  if (!isRevertableAction(action)) {
    throw new ChatbotError("bad_request:api", "Activity is not revertable");
  }

  if (action === "create") {
    const decision = targets.decision;

    if (!decision) {
      throw new ChatbotError("bad_request:api", "Create log has no decision");
    }

    if (decision.status === "archived") {
      return { ok: true, already_reverted: true };
    }

    if (!decisionMatches(decision, metadata.after)) {
      throw new AgentActivityConflictError("Decision changed after create", {
        decision,
      });
    }

    const archived = await updateDecisionRecord(decision.id, {
      status: "archived",
    });
    const revertLogId = await insertRevertLog({
      decisionId: decision.id,
      originalLogId: logId,
      action,
      metadata: { before: decision, after: archived },
    });

    return { ok: true, log_id: revertLogId, decision: archived };
  }

  if (action === "update") {
    const decision = targets.decision;

    if (!decision) {
      throw new ChatbotError("bad_request:api", "Update log has no decision");
    }

    if (!decisionMatches(decision, metadata.after)) {
      throw new AgentActivityConflictError("Decision changed after update", {
        decision,
      });
    }

    const reverted = await updateDecisionRecord(
      decision.id,
      pickDecisionPatch(metadata.before)
    );
    const revertLogId = await insertRevertLog({
      decisionId: decision.id,
      originalLogId: logId,
      action,
      metadata: { before: decision, after: reverted },
    });

    return { ok: true, log_id: revertLogId, decision: reverted };
  }

  if (action === "archive") {
    const decision = targets.decision;

    if (!decision) {
      throw new ChatbotError("bad_request:api", "Archive log has no decision");
    }

    if (decision.status === "active") {
      return { ok: true, already_reverted: true };
    }

    if (decision.status !== "archived") {
      throw new AgentActivityConflictError("Decision changed after archive", {
        decision,
      });
    }

    const active = await updateDecisionRecord(decision.id, {
      status: "active",
    });
    const revertLogId = await insertRevertLog({
      decisionId: decision.id,
      originalLogId: logId,
      action,
      metadata: { before: decision, after: active },
    });

    return { ok: true, log_id: revertLogId, decision: active };
  }

  if (action === "supersede") {
    const newDecisionId = getMetadataString(metadata, "new_decision_id");
    const oldDecisionId = getMetadataString(metadata, "superseded_decision_id");
    const edgeId = getMetadataString(metadata, "edge_id");

    if (!(newDecisionId && oldDecisionId && edgeId)) {
      throw new ChatbotError(
        "bad_request:api",
        "Supersede log is missing metadata"
      );
    }

    const [newDecision, oldDecision, edge] = await Promise.all([
      getDecisionById(newDecisionId),
      getDecisionById(oldDecisionId),
      getEdgeById(edgeId),
    ]);

    if (
      !newDecision ||
      !oldDecision ||
      newDecision.projectId !== projectId ||
      oldDecision.projectId !== projectId
    ) {
      throw new ChatbotError("forbidden:chat", "Supersede target not found");
    }

    if (oldDecision.status === "active" && newDecision.status === "archived") {
      return { ok: true, already_reverted: true };
    }

    if (
      oldDecision.status !== "superseded" ||
      newDecision.status !== "active"
    ) {
      throw new AgentActivityConflictError("Decision changed after supersede", {
        oldDecision,
        newDecision,
      });
    }

    await updateDecisionRecord(oldDecision.id, { status: "active" });
    const archivedNew = await updateDecisionRecord(newDecision.id, {
      status: "archived",
    });

    if (edge) {
      await deleteEdgeById(edgeId);
    }

    const revertLogId = await insertRevertLog({
      decisionId: oldDecision.id,
      originalLogId: logId,
      action,
      metadata: {
        restored_decision_id: oldDecision.id,
        archived_decision_id: newDecision.id,
        deleted_edge_id: edgeId,
      },
    });

    return { ok: true, log_id: revertLogId, decision: archivedNew };
  }

  if (action === "create_edge") {
    const edge = asRecord(metadata.edge);
    const edgeId = typeof edge.id === "string" ? edge.id : null;

    if (!edgeId) {
      throw new ChatbotError(
        "bad_request:api",
        "Create edge log is missing metadata"
      );
    }

    const currentEdge = await getEdgeById(edgeId);

    if (!currentEdge) {
      return { ok: true, already_reverted: true };
    }

    await deleteEdgeById(edgeId);
    const revertLogId = await insertRevertLog({
      decisionId: String(edge.source_decision_id),
      originalLogId: logId,
      action,
      metadata: { deleted_edge: edge },
    });

    return { ok: true, log_id: revertLogId };
  }

  if (action === "delete_edge") {
    const edge = asRecord(metadata.deleted_edge);

    if (!edge.id) {
      throw new ChatbotError(
        "bad_request:api",
        "Delete edge log is missing metadata"
      );
    }

    const existing = await findMatchingEdge(edge);

    if (existing) {
      return { ok: true, already_reverted: true };
    }

    const recreated = await insertEdge(edge);
    const revertLogId = await insertRevertLog({
      decisionId: String(edge.source_decision_id),
      originalLogId: logId,
      action,
      metadata: { recreated_edge: recreated },
    });

    return { ok: true, log_id: revertLogId };
  }

  throw new ChatbotError("bad_request:api", "Unsupported revert action");
}
