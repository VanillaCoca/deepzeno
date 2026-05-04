import "server-only";

import { isDecisionKind } from "@/lib/decision-kinds";
import { serializeDecisionGraph } from "@/lib/decision-serializer";
import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceApiKey } from "@/lib/workspace/types";

type DatabaseRecord = Record<string, unknown>;

function getClient() {
  return getSupabaseAdminClient() as any;
}

function ensureProjectScope(apiKey: WorkspaceApiKey, projectId: string) {
  if (apiKey.projectId !== projectId) {
    throw new ChatbotError(
      "forbidden:chat",
      "API key is not authorized for this project"
    );
  }
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
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

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : null;
}

function mapTopic(row: DatabaseRecord) {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    label: String(row.label),
    is_general: Boolean(row.is_general),
    archived_at: toNullableString(row.archived_at),
    position: Number(row.position ?? 0),
    created_at: toIsoString(row.created_at),
  };
}

function mapDecision(row: DatabaseRecord) {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    topic_id: String(row.topic_id),
    title: String(row.title),
    content: String(row.content),
    rationale: toNullableString(row.rationale),
    kind: String(row.kind ?? "plan"),
    weight: String(row.weight ?? "normal"),
    status: String(row.status ?? "active"),
    relevant_message_ids: toStringArray(row.relevant_message_ids),
    created_from_message_id: toNullableString(row.created_from_message_id),
    confirmed_by_user_id: toNullableString(row.confirmed_by_user_id),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

function mapEdge(row: DatabaseRecord) {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    topic_id: String(row.topic_id),
    source_decision_id: String(row.source_decision_id),
    target_decision_id: String(row.target_decision_id),
    type: String(row.type),
    created_at: toIsoString(row.created_at),
  };
}

async function ensureTopicInProject({
  topicId,
  projectId,
}: {
  topicId: string;
  projectId: string;
}) {
  const client = getClient();
  const { data, error } = await client
    .from("topics")
    .select("*")
    .eq("id", topicId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load project topic", error);
    throw new ChatbotError("bad_request:database", "Failed to load topic");
  }

  if (!data) {
    throw new ChatbotError("forbidden:chat", "Topic not found in project");
  }

  return mapTopic(data as DatabaseRecord);
}

async function getDecisionRow(decisionId: string) {
  const client = getClient();
  const { data, error } = await client
    .from("decisions")
    .select("*")
    .eq("id", decisionId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load decision", error);
    throw new ChatbotError("bad_request:database", "Failed to load decision");
  }

  if (!data) {
    throw new ChatbotError("not_found:chat", "Decision not found");
  }

  return mapDecision(data as DatabaseRecord);
}

export async function listMcpTopics({
  apiKey,
  projectId,
}: {
  apiKey: WorkspaceApiKey;
  projectId: string;
}) {
  ensureProjectScope(apiKey, projectId);

  const client = getClient();
  const { data, error } = await client
    .from("topics")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to list topics", error);
    throw new ChatbotError("bad_request:database", "Failed to list topics");
  }

  return ((data ?? []) as DatabaseRecord[]).map(mapTopic);
}

export async function listMcpDecisions({
  apiKey,
  projectId,
  topicId,
  kind,
  status,
}: {
  apiKey: WorkspaceApiKey;
  projectId: string;
  topicId?: string | null;
  kind?: string | null;
  status?: string | null;
}) {
  ensureProjectScope(apiKey, projectId);

  if (topicId) {
    await ensureTopicInProject({ topicId, projectId });
  }

  const client = getClient();
  let query = client.from("decisions").select("*").eq("project_id", projectId);

  if (topicId) {
    query = query.eq("topic_id", topicId);
  }

  if (kind) {
    query = query.eq("kind", kind);
  }

  query = query.eq("status", status?.trim() || "active");

  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    console.error("Failed to list decisions", error);
    throw new ChatbotError("bad_request:database", "Failed to list decisions");
  }

  return ((data ?? []) as DatabaseRecord[]).map(mapDecision);
}

export async function getMcpDecision({
  apiKey,
  decisionId,
}: {
  apiKey: WorkspaceApiKey;
  decisionId: string;
}) {
  const decision = await getDecisionRow(decisionId);
  ensureProjectScope(apiKey, decision.project_id);

  const client = getClient();
  const { data, error } = await client
    .from("edges")
    .select("*")
    .or(
      `source_decision_id.eq.${decisionId},target_decision_id.eq.${decisionId}`
    )
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load decision edges", error);
    throw new ChatbotError(
      "bad_request:database",
      "Failed to load decision relations"
    );
  }

  return {
    decision,
    edges: ((data ?? []) as DatabaseRecord[]).map(mapEdge),
  };
}

export async function getMcpProjectContext({
  apiKey,
  projectId,
  topicId,
}: {
  apiKey: WorkspaceApiKey;
  projectId: string;
  topicId?: string | null;
}) {
  ensureProjectScope(apiKey, projectId);

  const [topics, decisions, edges] = await Promise.all([
    listMcpTopics({ apiKey, projectId }),
    listMcpDecisions({
      apiKey,
      projectId,
      topicId,
      status: "active",
    }),
    (async () => {
      const client = getClient();
      let query = client.from("edges").select("*").eq("project_id", projectId);

      if (topicId) {
        await ensureTopicInProject({ topicId, projectId });
        query = query.eq("topic_id", topicId);
      }

      const { data, error } = await query.order("created_at", {
        ascending: true,
      });

      if (error) {
        console.error("Failed to list edges", error);
        throw new ChatbotError("bad_request:database", "Failed to list edges");
      }

      return ((data ?? []) as DatabaseRecord[]).map(mapEdge);
    })(),
  ]);

  const activeOpenQuestions = decisions.filter(
    (decision) => decision.kind === "open_question"
  );
  const activeRejections = decisions.filter(
    (decision) => decision.kind === "rejection"
  );

  return {
    project_id: projectId,
    topic_id: topicId ?? null,
    topics,
    decisions,
    open_questions: activeOpenQuestions,
    rejections: activeRejections,
    edges,
    serialized_graph: serializeDecisionGraph(
      decisions.map((decision) => ({
        id: decision.id,
        projectId: decision.project_id,
        topicId: decision.topic_id,
        title: decision.title,
        content: decision.content,
        rationale: decision.rationale,
        kind: decision.kind,
        weight: decision.weight,
        status: decision.status,
        sensitivity: "normal",
        relevantMessageIds: decision.relevant_message_ids,
        createdFromMessageId: decision.created_from_message_id,
        confirmedByUserId: decision.confirmed_by_user_id,
        createdAt: decision.created_at,
        updatedAt: decision.updated_at,
      })),
      edges.map((edge) => ({
        id: edge.id,
        projectId: edge.project_id,
        topicId: edge.topic_id,
        sourceDecisionId: edge.source_decision_id,
        targetDecisionId: edge.target_decision_id,
        type: edge.type,
        createdAt: edge.created_at,
      }))
    ),
  };
}

export async function submitMcpCandidate({
  apiKey,
  projectId,
  topicId,
  proposedTitle,
  proposedContent,
  proposedKind,
  proposedRationale,
  externalEvidence,
  sourceMetadata,
}: {
  apiKey: WorkspaceApiKey;
  projectId: string;
  topicId: string;
  proposedTitle: string;
  proposedContent: string;
  proposedKind: string;
  proposedRationale?: string | null;
  externalEvidence?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
}) {
  ensureProjectScope(apiKey, projectId);
  await ensureTopicInProject({ topicId, projectId });

  if (!isDecisionKind(proposedKind)) {
    throw new ChatbotError("bad_request:api", "Invalid proposed_kind");
  }

  const client = getClient();
  const { data, error } = await client
    .from("candidate_decisions")
    .insert({
      project_id: projectId,
      topic_id: topicId,
      proposed_title: proposedTitle,
      proposed_content: proposedContent,
      proposed_kind: proposedKind,
      proposed_rationale: proposedRationale ?? null,
      proposed_weight: "normal",
      confidence: 1,
      pre_selected: proposedKind === "rejection" ? false : true,
      status: "pending",
      source: "mcp_agent",
      source_metadata: sourceMetadata ?? null,
      external_evidence: externalEvidence ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to submit MCP candidate", error);
    throw new ChatbotError(
      "bad_request:database",
      "Failed to submit candidate"
    );
  }

  return {
    candidate_id: String((data as DatabaseRecord).id),
  };
}
