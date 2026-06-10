import "server-only";

import { randomUUID } from "node:crypto";
import {
  assembleContext,
  assembleProjectContext,
} from "@/lib/context-assembly";
import type { CodeAnchor } from "@/lib/decision-anchors";
import { normalizeCodeAnchors } from "@/lib/decision-anchors";
import { type DecisionKind, isDecisionKind } from "@/lib/decision-kinds";
import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceApiKey } from "@/lib/workspace/types";

type DatabaseRecord = Record<string, unknown>;

type AgentWriteContext = {
  agent: string;
  sessionId?: string | null;
  requestId?: string;
};

const decisionWeights = ["low", "normal", "high"] as const;
type DecisionWeight = (typeof decisionWeights)[number];

const edgeTypes = new Set([
  "supports",
  "contradicts",
  "blocks",
  "blocked_by",
  "depends_on",
  "supersedes",
  "resolves",
  "related_to",
]);

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

function ensureDecisionKind(value: string): asserts value is DecisionKind {
  if (!isDecisionKind(value)) {
    throw new ChatbotError("bad_request:api", "Invalid decision kind");
  }
}

function ensureDecisionWeight(value: string): asserts value is DecisionWeight {
  if (!(decisionWeights as readonly string[]).includes(value)) {
    throw new ChatbotError("bad_request:api", "Invalid decision weight");
  }
}

function ensureEdgeType(value: string) {
  if (!edgeTypes.has(value)) {
    throw new ChatbotError("bad_request:api", "Invalid edge type");
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

function truncateText(value: string | null | undefined, maxLength = 160) {
  if (!value) {
    return null;
  }

  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value;
}

function mapTopic(row: DatabaseRecord) {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    label: String(row.label),
    is_general: Boolean(row.is_general),
    status: String(row.status ?? "exploring"),
    description: toNullableString(row.description),
    archived_at: toNullableString(row.archived_at),
    decided_at: toNullableString(row.decided_at),
    executing_at: toNullableString(row.executing_at),
    superseded_at: toNullableString(row.superseded_at),
    dismissed_at: toNullableString(row.dismissed_at),
    position: Number(row.position ?? 0),
    created_at: toIsoString(row.created_at),
  };
}

function mapTopicRelation(row: DatabaseRecord) {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    from_topic_id: String(row.from_topic_id),
    to_topic_id: String(row.to_topic_id),
    relation_type: String(row.relation_type),
    created_at: toIsoString(row.created_at),
  };
}

function mapIRNode(row: DatabaseRecord) {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    topic_id: toNullableString(row.topic_id),
    kind: String(row.kind),
    subtype: toNullableString(row.subtype),
    status: String(row.status),
    title: String(row.title),
    content: toNullableString(row.content),
    rationale: toNullableString(row.rationale),
    source_layer: toNullableString(row.source_layer),
    created_by: String(row.created_by ?? "user"),
    created_at: toIsoString(row.created_at),
    confirmed_at: toNullableString(row.confirmed_at),
    superseded_at: toNullableString(row.superseded_at),
    superseded_by: toNullableString(row.superseded_by),
  };
}

function mapIREdge(row: DatabaseRecord) {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    from_node: String(row.from_node),
    to_node: String(row.to_node),
    relation: String(row.relation),
    status: String(row.status ?? "pending"),
    created_at: toIsoString(row.created_at),
    confirmed_at: toNullableString(row.confirmed_at),
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
    code_anchors: normalizeCodeAnchors(row.code_anchors),
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

async function getEdgeRow(edgeId: string) {
  const client = getClient();
  const { data, error } = await client
    .from("edges")
    .select("*")
    .eq("id", edgeId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load edge", error);
    throw new ChatbotError("bad_request:database", "Failed to load edge");
  }

  if (!data) {
    throw new ChatbotError("not_found:chat", "Edge not found");
  }

  return mapEdge(data as DatabaseRecord);
}

async function findIdenticalEdge(input: {
  projectId: string;
  sourceDecisionId: string;
  targetDecisionId: string;
  type: string;
}) {
  const client = getClient();
  const { data, error } = await client
    .from("edges")
    .select("*")
    .eq("project_id", input.projectId)
    .eq("source_decision_id", input.sourceDecisionId)
    .eq("target_decision_id", input.targetDecisionId)
    .eq("type", input.type)
    .maybeSingle();

  if (error) {
    console.error("Failed to inspect MCP edge duplicate", error);
    throw new ChatbotError("bad_request:database", "Failed to inspect edge");
  }

  return data ? mapEdge(data as DatabaseRecord) : null;
}

function buildInputSummary(input: {
  title?: string | null;
  kind?: string | null;
  action?: string;
}) {
  return {
    title: truncateText(input.title),
    kind: input.kind ?? null,
    action: input.action ?? null,
  };
}

function buildAgentMetadata({
  apiKey,
  write,
  tool,
  codeAnchors,
  inputSummary,
  extra,
}: {
  apiKey: WorkspaceApiKey;
  write: AgentWriteContext;
  tool: string;
  codeAnchors?: CodeAnchor[] | null;
  inputSummary: Record<string, unknown>;
  extra?: Record<string, unknown>;
}) {
  return {
    agent: write.agent,
    api_key_id: apiKey.id,
    ...(write.sessionId ? { session_id: write.sessionId } : {}),
    tool,
    request_id: write.requestId ?? randomUUID(),
    code_anchors_at_write: codeAnchors ?? [],
    input_summary: inputSummary,
    ...(extra ?? {}),
  };
}

async function insertDecisionLog(input: {
  decisionId?: string | null;
  candidateId?: string | null;
  action: string;
  actorType?: "user" | "external_agent" | "system";
  metadata?: Record<string, unknown> | null;
}) {
  const client = getClient();
  const { data, error } = await client
    .from("decision_log")
    .insert({
      decision_id: input.decisionId ?? null,
      candidate_id: input.candidateId ?? null,
      action: input.action,
      actor_type: input.actorType ?? "external_agent",
      metadata: input.metadata ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to insert MCP decision log", error);
    throw new ChatbotError(
      "bad_request:database",
      "Failed to insert decision log"
    );
  }

  return String((data as DatabaseRecord).id);
}

async function insertCandidateRow(input: {
  projectId: string;
  topicId: string;
  proposedTitle: string | null;
  proposedContent: string;
  proposedKind: DecisionKind;
  proposedRationale?: string | null;
  proposedWeight?: DecisionWeight | null;
  proposedForDecisionId?: string | null;
  proposedStatus?: string | null;
  proposedIntent?: string | null;
  suggestedEdges?: Array<{ type: string; targetDecisionId: string }> | null;
  relevantMessageIds?: string[] | null;
  sourceMetadata?: Record<string, unknown> | null;
  externalEvidence?: string | null;
}) {
  const client = getClient();
  const { data, error } = await client
    .from("candidate_decisions")
    .insert({
      project_id: input.projectId,
      topic_id: input.topicId,
      proposed_title: input.proposedTitle,
      proposed_content: input.proposedContent,
      proposed_kind: input.proposedKind,
      proposed_rationale: input.proposedRationale ?? null,
      proposed_weight: input.proposedWeight ?? "normal",
      proposed_for_decision_id: input.proposedForDecisionId ?? null,
      proposed_status: input.proposedStatus ?? null,
      proposed_intent: input.proposedIntent ?? "create",
      suggested_edges: input.suggestedEdges ?? null,
      confidence: 1,
      pre_selected: input.proposedKind !== "rejection",
      status: "pending",
      source: "mcp_agent",
      source_metadata: input.sourceMetadata ?? null,
      relevant_message_ids: input.relevantMessageIds ?? null,
      external_evidence: input.externalEvidence ?? null,
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

  return String((data as DatabaseRecord).id);
}

// Iron Law 4 (constitution amendment #1): every MCP write is candidate-first.
// This is the only write primitive in this service — there is no direct path
// to the decisions/edges tables, so the funnel cannot be bypassed.
async function submitRoutedCandidate(input: {
  apiKey: WorkspaceApiKey;
  projectId: string;
  topicId: string;
  proposedTitle: string | null;
  proposedContent: string;
  proposedKind: DecisionKind;
  proposedRationale?: string | null;
  proposedWeight?: DecisionWeight | null;
  proposedForDecisionId?: string | null;
  proposedStatus?: string | null;
  proposedIntent:
    | "create"
    | "update"
    | "archive"
    | "supersede"
    | "create_edge"
    | "delete_edge";
  suggestedEdges?: Array<{ type: string; targetDecisionId: string }> | null;
  relevantMessageIds?: string[] | null;
  codeAnchors?: CodeAnchor[] | null;
  write: AgentWriteContext;
  tool: string;
  metadata?: Record<string, unknown>;
}) {
  ensureProjectScope(input.apiKey, input.projectId);
  await ensureTopicInProject({
    topicId: input.topicId,
    projectId: input.projectId,
  });

  const logMetadata = buildAgentMetadata({
    apiKey: input.apiKey,
    write: input.write,
    tool: input.tool,
    codeAnchors: input.codeAnchors,
    inputSummary: buildInputSummary({
      title: input.proposedTitle,
      kind: input.proposedKind,
      action: input.proposedIntent,
    }),
    extra: {
      route: "candidate",
      proposed_intent: input.proposedIntent,
      ...(input.proposedForDecisionId
        ? { proposed_for_decision_id: input.proposedForDecisionId }
        : {}),
      ...(input.proposedStatus
        ? { proposed_status: input.proposedStatus }
        : {}),
      ...(input.metadata ?? {}),
    },
  });
  const candidateId = await insertCandidateRow({
    projectId: input.projectId,
    topicId: input.topicId,
    proposedTitle: input.proposedTitle,
    proposedContent: input.proposedContent,
    proposedKind: input.proposedKind,
    proposedRationale: input.proposedRationale,
    proposedWeight: input.proposedWeight,
    proposedForDecisionId: input.proposedForDecisionId,
    proposedStatus: input.proposedStatus,
    proposedIntent: input.proposedIntent,
    suggestedEdges: input.suggestedEdges,
    relevantMessageIds: input.relevantMessageIds,
    sourceMetadata: logMetadata,
  });
  const logId = await insertDecisionLog({
    candidateId,
    action: "candidate_submitted",
    actorType: "external_agent",
    metadata: logMetadata,
  });

  return {
    ok: true,
    route: "candidate" as const,
    candidate_id: candidateId,
    log_id: logId,
    requires_approval: true,
  };
}

function externalAgentContext(input: {
  agent: string;
  sessionId?: string | null;
}) {
  return {
    agent: input.agent,
    sessionId: input.sessionId ?? null,
    requestId: randomUUID(),
  };
}

export async function listMcpTopics({
  apiKey,
  projectId,
  status,
}: {
  apiKey: WorkspaceApiKey;
  projectId: string;
  status?: string | null;
}) {
  ensureProjectScope(apiKey, projectId);

  const client = getClient();
  let query = client.from("topics").select("*").eq("project_id", projectId);

  if (status?.trim()) {
    query = query.eq("status", status.trim());
  }

  const { data, error } = await query
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to list topics", error);
    throw new ChatbotError("bad_request:database", "Failed to list topics");
  }

  return ((data ?? []) as DatabaseRecord[]).map(mapTopic);
}

async function listMcpTopicRelations(projectId: string) {
  const { data, error } = await getClient()
    .from("topic_relations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to list topic relations", error);
    throw new ChatbotError(
      "bad_request:database",
      "Failed to list topic relations"
    );
  }

  return ((data ?? []) as DatabaseRecord[]).map(mapTopicRelation);
}

async function listMcpIRNodes({
  projectId,
  topicId,
  status = "active",
  query: searchQuery,
}: {
  projectId: string;
  topicId?: string | null;
  status?: string | null;
  query?: string | null;
}) {
  const client = getClient();
  let query = client.from("ir_nodes").select("*").eq("project_id", projectId);

  if (status?.trim()) {
    query = query.eq("status", status.trim());
  }

  if (topicId) {
    query = query.eq("topic_id", topicId);
  }

  if (searchQuery?.trim()) {
    const term = searchQuery.trim().replaceAll("%", "\\%");
    query = query.or(
      `title.ilike.%${term}%,content.ilike.%${term}%,rationale.ilike.%${term}%`
    );
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });

  if (error) {
    console.error("Failed to list IR nodes", error);
    throw new ChatbotError("bad_request:database", "Failed to list IR nodes");
  }

  return ((data ?? []) as DatabaseRecord[]).map(mapIRNode);
}

async function listMcpIREdgesForNodes(projectId: string, nodeIds: string[]) {
  if (nodeIds.length === 0) {
    return [];
  }

  const { data, error } = await getClient()
    .from("ir_edges")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "active")
    .in("from_node", nodeIds)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to list IR edges", error);
    throw new ChatbotError("bad_request:database", "Failed to list IR edges");
  }

  const nodeIdSet = new Set(nodeIds);
  return ((data ?? []) as DatabaseRecord[])
    .map(mapIREdge)
    .filter((edge) => nodeIdSet.has(edge.to_node));
}

export async function getMcpIRNode({
  apiKey,
  nodeId,
}: {
  apiKey: WorkspaceApiKey;
  nodeId: string;
}) {
  const { data, error } = await getClient()
    .from("ir_nodes")
    .select("*")
    .eq("id", nodeId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load IR node", error);
    throw new ChatbotError("bad_request:database", "Failed to load IR node");
  }

  if (!data) {
    throw new ChatbotError("not_found:chat", "IR node not found");
  }

  const node = mapIRNode(data as DatabaseRecord);
  ensureProjectScope(apiKey, node.project_id);

  return node;
}

export async function searchMcpIR({
  apiKey,
  projectId,
  query,
  topicId,
}: {
  apiKey: WorkspaceApiKey;
  projectId: string;
  query: string;
  topicId?: string | null;
}) {
  ensureProjectScope(apiKey, projectId);

  if (topicId) {
    await ensureTopicInProject({ topicId, projectId });
  }

  return listMcpIRNodes({
    projectId,
    topicId,
    status: null,
    query,
  });
}

export async function getMcpTopicContext({
  apiKey,
  topicId,
  includeRelationClosure = true,
}: {
  apiKey: WorkspaceApiKey;
  topicId: string;
  includeRelationClosure?: boolean;
}) {
  const topic = await ensureTopicInProject({
    topicId,
    projectId: apiKey.projectId,
  });
  const nodes = await listMcpIRNodes({
    projectId: topic.project_id,
    topicId,
    status: "active",
  });
  const edges = await listMcpIREdgesForNodes(
    topic.project_id,
    nodes.map((node) => node.id)
  );

  return {
    topic,
    ir_nodes: nodes,
    ir_edges: edges,
    serialized_context: includeRelationClosure
      ? await assembleContext(topicId, topic.project_id)
      : null,
  };
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

  if (topicId) {
    return getMcpTopicContext({
      apiKey,
      topicId,
      includeRelationClosure: true,
    });
  }

  const [topics, topicRelations] = await Promise.all([
    listMcpTopics({ apiKey, projectId }),
    listMcpTopicRelations(projectId),
  ]);
  const activeTopicIds = topics
    .filter(
      (topic) =>
        !topic.is_general &&
        !topic.archived_at &&
        (topic.status === "decided" || topic.status === "executing")
    )
    .map((topic) => topic.id);
  const nodes =
    activeTopicIds.length > 0
      ? (
          await Promise.all(
            activeTopicIds.map((activeTopicId) =>
              listMcpIRNodes({
                projectId,
                topicId: activeTopicId,
                status: "active",
              })
            )
          )
        ).flat()
      : [];
  const edges = await listMcpIREdgesForNodes(
    projectId,
    nodes.map((node) => node.id)
  );

  return {
    project_id: projectId,
    topic_id: null,
    topics,
    topic_relations: topicRelations,
    ir_nodes: nodes,
    ir_edges: edges,
    serialized_context: await assembleProjectContext(projectId),
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
  ensureDecisionKind(proposedKind);
  const agent =
    typeof sourceMetadata?.agent === "string" && sourceMetadata.agent.trim()
      ? sourceMetadata.agent
      : "unknown";
  const sessionId =
    typeof sourceMetadata?.session_id === "string"
      ? sourceMetadata.session_id
      : null;
  const write = externalAgentContext({ agent, sessionId });
  const logMetadata = buildAgentMetadata({
    apiKey,
    write,
    tool: "submit_candidate",
    inputSummary: buildInputSummary({
      title: proposedTitle,
      kind: proposedKind,
      action: "create",
    }),
    extra: {
      route: "candidate",
      proposed_intent: "create",
      source_metadata: sourceMetadata ?? null,
    },
  });

  ensureProjectScope(apiKey, projectId);
  await ensureTopicInProject({ topicId, projectId });
  const candidateId = await insertCandidateRow({
    projectId,
    topicId,
    proposedTitle,
    proposedContent,
    proposedKind,
    proposedRationale,
    proposedWeight: "normal",
    proposedIntent: "create",
    externalEvidence,
    sourceMetadata: logMetadata,
  });
  const logId = await insertDecisionLog({
    candidateId,
    action: "candidate_submitted",
    actorType: "external_agent",
    metadata: logMetadata,
  });

  return {
    candidate_id: candidateId,
    log_id: logId,
  };
}

export async function createMcpDecision({
  apiKey,
  projectId,
  topicId,
  title,
  content,
  kind,
  rationale,
  weight = "normal",
  relevantMessageIds,
  codeAnchors,
  agent,
  sessionId,
}: {
  apiKey: WorkspaceApiKey;
  projectId: string;
  topicId: string;
  title: string;
  content: string;
  kind: string;
  rationale?: string | null;
  weight?: string | null;
  relevantMessageIds?: string[] | null;
  codeAnchors?: CodeAnchor[] | null;
  agent: string;
  sessionId?: string | null;
}) {
  ensureDecisionKind(kind);
  const normalizedWeight = weight ?? "normal";
  ensureDecisionWeight(normalizedWeight);
  ensureProjectScope(apiKey, projectId);
  await ensureTopicInProject({ topicId, projectId });

  const write = externalAgentContext({ agent, sessionId });

  return submitRoutedCandidate({
    apiKey,
    projectId,
    topicId,
    proposedTitle: title,
    proposedContent: content,
    proposedKind: kind,
    proposedRationale: rationale,
    proposedWeight: normalizedWeight,
    proposedIntent: "create",
    relevantMessageIds,
    codeAnchors,
    write,
    tool: "create_decision",
  });
}

export async function updateMcpDecision({
  apiKey,
  decisionId,
  title,
  content,
  rationale,
  kind,
  weight,
  codeAnchors,
  agent,
  sessionId,
}: {
  apiKey: WorkspaceApiKey;
  decisionId: string;
  title?: string;
  content?: string;
  rationale?: string | null;
  kind?: string;
  weight?: string;
  codeAnchors?: CodeAnchor[] | null;
  agent: string;
  sessionId?: string | null;
}) {
  if (kind !== undefined) {
    ensureDecisionKind(kind);
  }

  if (weight !== undefined) {
    ensureDecisionWeight(weight);
  }

  const hasPatch =
    title !== undefined ||
    content !== undefined ||
    rationale !== undefined ||
    kind !== undefined ||
    weight !== undefined ||
    codeAnchors !== undefined;

  if (!hasPatch) {
    throw new ChatbotError(
      "bad_request:api",
      "At least one decision field must be provided"
    );
  }

  const current = await getDecisionRow(decisionId);
  ensureProjectScope(apiKey, current.project_id);

  const write = externalAgentContext({ agent, sessionId });
  const nextTitle = title ?? current.title;
  const nextContent = content ?? current.content;
  const nextKindValue = (kind ?? current.kind) as DecisionKind;
  const nextWeight = (weight ?? current.weight) as DecisionWeight;
  const nextCodeAnchors =
    codeAnchors === undefined ? current.code_anchors : codeAnchors;

  return submitRoutedCandidate({
    apiKey,
    projectId: current.project_id,
    topicId: current.topic_id,
    proposedTitle: nextTitle,
    proposedContent: nextContent,
    proposedKind: nextKindValue,
    proposedRationale: rationale === undefined ? current.rationale : rationale,
    proposedWeight: nextWeight,
    proposedForDecisionId: current.id,
    proposedIntent: "update",
    codeAnchors: nextCodeAnchors,
    write,
    tool: "update_decision",
    metadata: {
      before: current,
      patch: {
        title: title ?? null,
        content: content ?? null,
        rationale: rationale ?? null,
        kind: kind ?? null,
        weight: weight ?? null,
        code_anchors: codeAnchors ?? null,
      },
    },
  });
}

export async function archiveMcpDecision({
  apiKey,
  decisionId,
  reason,
  agent,
  sessionId,
}: {
  apiKey: WorkspaceApiKey;
  decisionId: string;
  reason?: string | null;
  agent: string;
  sessionId?: string | null;
}) {
  const current = await getDecisionRow(decisionId);
  ensureProjectScope(apiKey, current.project_id);

  const write = externalAgentContext({ agent, sessionId });

  return submitRoutedCandidate({
    apiKey,
    projectId: current.project_id,
    topicId: current.topic_id,
    proposedTitle: current.title,
    proposedContent: current.content,
    proposedKind: current.kind as DecisionKind,
    proposedRationale: current.rationale,
    proposedWeight: current.weight as DecisionWeight,
    proposedForDecisionId: current.id,
    proposedStatus: "archived",
    proposedIntent: "archive",
    codeAnchors: current.code_anchors,
    write,
    tool: "archive_decision",
    metadata: {
      reason: reason ?? null,
      before: current,
    },
  });
}

export async function supersedeMcpDecision({
  apiKey,
  supersededDecisionId,
  newTitle,
  newContent,
  newRationale,
  newKind,
  newWeight,
  newCodeAnchors,
  reason,
  agent,
  sessionId,
}: {
  apiKey: WorkspaceApiKey;
  supersededDecisionId: string;
  newTitle: string;
  newContent: string;
  newRationale?: string | null;
  newKind?: string | null;
  newWeight?: string | null;
  newCodeAnchors?: CodeAnchor[] | null;
  reason: string;
  agent: string;
  sessionId?: string | null;
}) {
  if (newKind !== undefined && newKind !== null) {
    ensureDecisionKind(newKind);
  }

  if (newWeight !== undefined && newWeight !== null) {
    ensureDecisionWeight(newWeight);
  }

  const oldDecision = await getDecisionRow(supersededDecisionId);
  ensureProjectScope(apiKey, oldDecision.project_id);

  const nextKind = (newKind ?? oldDecision.kind) as DecisionKind;
  const nextWeight = (newWeight ?? oldDecision.weight) as DecisionWeight;
  const write = externalAgentContext({ agent, sessionId });

  return submitRoutedCandidate({
    apiKey,
    projectId: oldDecision.project_id,
    topicId: oldDecision.topic_id,
    proposedTitle: newTitle,
    proposedContent: newContent,
    proposedKind: nextKind,
    proposedRationale: newRationale,
    proposedWeight: nextWeight,
    proposedForDecisionId: oldDecision.id,
    proposedIntent: "supersede",
    codeAnchors: newCodeAnchors ?? null,
    write,
    tool: "supersede_decision",
    metadata: {
      reason,
      before: oldDecision,
    },
  });
}

export async function resolveMcpOpenQuestion({
  apiKey,
  questionDecisionId,
  resolution,
  answerKind,
  answerTitle,
  answerContent,
  answerRationale,
  answerCodeAnchors,
  agent,
  sessionId,
}: {
  apiKey: WorkspaceApiKey;
  questionDecisionId: string;
  resolution: "answered" | "no_longer_relevant" | "split";
  answerKind?: string | null;
  answerTitle?: string | null;
  answerContent?: string | null;
  answerRationale?: string | null;
  answerCodeAnchors?: CodeAnchor[] | null;
  agent: string;
  sessionId?: string | null;
}) {
  const question = await getDecisionRow(questionDecisionId);
  ensureProjectScope(apiKey, question.project_id);

  if (question.kind !== "open_question" || question.status !== "active") {
    throw new ChatbotError(
      "bad_request:api",
      "Only active open questions can be resolved"
    );
  }

  if (resolution === "split") {
    throw new ChatbotError(
      "bad_request:api",
      "split resolution is not implemented in V1"
    );
  }

  const write = externalAgentContext({ agent, sessionId });

  if (resolution === "no_longer_relevant") {
    return submitRoutedCandidate({
      apiKey,
      projectId: question.project_id,
      topicId: question.topic_id,
      proposedTitle: question.title,
      proposedContent: question.content,
      proposedKind: question.kind as DecisionKind,
      proposedRationale: question.rationale,
      proposedWeight: question.weight as DecisionWeight,
      proposedForDecisionId: question.id,
      proposedStatus: "archived",
      proposedIntent: "archive",
      codeAnchors: question.code_anchors,
      write,
      tool: "resolve_open_question",
      metadata: {
        resolution,
        before: question,
      },
    });
  }

  if (!answerTitle?.trim() || !answerContent?.trim()) {
    throw new ChatbotError(
      "bad_request:api",
      "answer_title and answer_content are required for answered resolution"
    );
  }

  const nextKind = answerKind ?? "plan";
  ensureDecisionKind(nextKind);

  // The answer is proposed as a create candidate carrying a resolves edge;
  // on confirmation the funnel creates the answer, links it, and closes the
  // question (see confirmCreateCandidate's resolves handling).
  return submitRoutedCandidate({
    apiKey,
    projectId: question.project_id,
    topicId: question.topic_id,
    proposedTitle: answerTitle,
    proposedContent: answerContent,
    proposedKind: nextKind,
    proposedRationale: answerRationale,
    proposedWeight: question.weight as DecisionWeight,
    proposedIntent: "create",
    suggestedEdges: [{ type: "resolves", targetDecisionId: question.id }],
    codeAnchors: answerCodeAnchors ?? null,
    write,
    tool: "resolve_open_question",
    metadata: {
      resolution,
      question_decision_id: question.id,
      before: question,
    },
  });
}

export async function createMcpEdge({
  apiKey,
  projectId,
  sourceDecisionId,
  targetDecisionId,
  type,
  agent,
  sessionId,
}: {
  apiKey: WorkspaceApiKey;
  projectId: string;
  sourceDecisionId: string;
  targetDecisionId: string;
  type: string;
  agent: string;
  sessionId?: string | null;
}) {
  ensureProjectScope(apiKey, projectId);
  ensureEdgeType(type);
  const [source, target] = await Promise.all([
    getDecisionRow(sourceDecisionId),
    getDecisionRow(targetDecisionId),
  ]);

  if (source.project_id !== projectId || target.project_id !== projectId) {
    throw new ChatbotError(
      "forbidden:chat",
      "Decisions must belong to the same project"
    );
  }

  const duplicate = await findIdenticalEdge({
    projectId,
    sourceDecisionId,
    targetDecisionId,
    type,
  });

  if (duplicate) {
    throw new ChatbotError("bad_request:api", "Identical edge already exists");
  }

  const write = externalAgentContext({ agent, sessionId });

  return submitRoutedCandidate({
    apiKey,
    projectId,
    topicId: source.topic_id,
    proposedTitle: `Link: ${truncateText(source.title, 60)} -[${type}]-> ${truncateText(target.title, 60)}`,
    proposedContent: `Proposed edge: "${source.title}" ${type} "${target.title}".`,
    proposedKind: source.kind as DecisionKind,
    proposedForDecisionId: source.id,
    proposedIntent: "create_edge",
    suggestedEdges: [{ type, targetDecisionId: target.id }],
    write,
    tool: "create_edge",
    metadata: {
      edge_proposal: {
        source_decision_id: source.id,
        target_decision_id: target.id,
        type,
      },
    },
  });
}

export async function deleteMcpEdge({
  apiKey,
  edgeId,
  reason,
  agent,
  sessionId,
}: {
  apiKey: WorkspaceApiKey;
  edgeId: string;
  reason?: string | null;
  agent: string;
  sessionId?: string | null;
}) {
  const edge = await getEdgeRow(edgeId);
  ensureProjectScope(apiKey, edge.project_id);

  const [source, target] = await Promise.all([
    getDecisionRow(edge.source_decision_id),
    getDecisionRow(edge.target_decision_id),
  ]);
  const write = externalAgentContext({ agent, sessionId });

  return submitRoutedCandidate({
    apiKey,
    projectId: edge.project_id,
    topicId: source.topic_id,
    proposedTitle: `Remove link: ${truncateText(source.title, 60)} -[${edge.type}]-> ${truncateText(target.title, 60)}`,
    proposedContent: `Proposed removal of edge "${source.title}" ${edge.type} "${target.title}".${reason ? ` Reason: ${reason}` : ""}`,
    proposedKind: source.kind as DecisionKind,
    proposedForDecisionId: edge.source_decision_id,
    proposedIntent: "delete_edge",
    write,
    tool: "delete_edge",
    metadata: {
      edge_id: edge.id,
      deleted_edge: edge,
      reason: reason ?? null,
    },
  });
}
