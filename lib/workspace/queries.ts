import "server-only";

import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  PendingCandidateCounts,
  WorkspaceCandidateDecision,
  WorkspaceConversation,
  WorkspaceDecision,
  WorkspaceEdge,
  WorkspaceMessageRecord,
  WorkspaceProject,
  WorkspaceProjectSummary,
  WorkspaceTopic,
} from "./types";

type DatabaseRecord = Record<string, unknown>;

type SuggestedEdge = NonNullable<
  WorkspaceCandidateDecision["suggestedEdges"]
>[number];

type InsertWorkspaceMessage = {
  id: string;
  conversationId: string;
  topicId: string;
  projectId: string;
  role: WorkspaceMessageRecord["role"];
  content: string;
  model?: string | null;
  createdAt?: string;
};

type InsertCandidateDecision = {
  projectId: string;
  topicId: string;
  conversationId?: string | null;
  messageId?: string | null;
  proposedTitle?: string | null;
  proposedContent: string;
  proposedRationale?: string | null;
  proposedKind?: string | null;
  proposedWeight?: string | null;
  confidence?: number | null;
  preSelected?: boolean;
  suggestedEdges?: WorkspaceCandidateDecision["suggestedEdges"];
  relevantMessageIds?: string[] | null;
  contentHash?: string | null;
  source?: string;
  sourceMetadata?: Record<string, unknown> | null;
  externalEvidence?: string | null;
};

type InsertDecision = {
  projectId: string;
  topicId: string;
  title: string;
  content: string;
  rationale?: string | null;
  kind?: string | null;
  weight?: string | null;
  status?: string | null;
  sensitivity?: string | null;
  relevantMessageIds?: string[] | null;
  createdFromMessageId?: string | null;
  confirmedByUserId?: string | null;
};

type InsertEdge = {
  projectId: string;
  topicId: string;
  sourceDecisionId: string;
  targetDecisionId: string;
  type: string;
};

type InsertDecisionLog = {
  decisionId?: string | null;
  candidateId?: string | null;
  action: string;
  actorType?: string;
  metadata?: Record<string, unknown> | null;
};

type DatabaseErrorLike = {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
};

type QueryContext = {
  operation?: string;
  table?: string;
  payload?: Record<string, unknown> | null;
};

function getClient(): any {
  return getSupabaseAdminClient() as any;
}

async function ensureResult(
  promise: PromiseLike<{ data: any; error: DatabaseErrorLike | null }>,
  message: string,
  context?: QueryContext
) {
  const { data, error } = await promise;

  if (error) {
    console.error(message, {
      code: error.code ?? null,
      message: error.message,
      details: error.details ?? null,
      hint: error.hint ?? null,
      context: context ?? null,
    });
    throw new ChatbotError("bad_request:database", message);
  }

  return data;
}

function isMissingTableError(error: DatabaseErrorLike | null | undefined) {
  return (
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table") === true
  );
}

function isLegacyUserForeignKeyError(
  error: DatabaseErrorLike | null | undefined
) {
  return (
    error?.code === "23503" &&
    (error.details?.includes('table "users"') === true ||
      error.details?.includes('table "User"') === true ||
      error.message.includes("projects_user_id_fkey"))
  );
}

async function ensureLegacyWorkspaceUserRecord({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail?: string | null;
}) {
  const client = getClient();
  const email = userEmail?.trim() || `${userId}@placeholder.zeno.invalid`;

  for (const tableName of ["users", "User"] as const) {
    const selectResult = await client
      .from(tableName)
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (selectResult.error) {
      if (isMissingTableError(selectResult.error)) {
        continue;
      }

      console.error("Failed to inspect legacy workspace user table", {
        code: selectResult.error.code ?? null,
        message: selectResult.error.message,
        details: selectResult.error.details ?? null,
        hint: selectResult.error.hint ?? null,
        context: {
          operation: "inspect_legacy_user",
          table: tableName,
          payload: {
            userId,
          },
        },
      });
      throw new ChatbotError(
        "bad_request:database",
        "Failed to prepare user record"
      );
    }

    if (selectResult.data) {
      return;
    }

    const insertResult = await client
      .from(tableName)
      .insert({
        id: userId,
        email,
      })
      .select("id")
      .single();

    if (insertResult.error) {
      console.error("Failed to insert legacy workspace user record", {
        code: insertResult.error.code ?? null,
        message: insertResult.error.message,
        details: insertResult.error.details ?? null,
        hint: insertResult.error.hint ?? null,
        context: {
          operation: "insert_legacy_user",
          table: tableName,
          payload: {
            userId,
            email,
          },
        },
      });
      throw new ChatbotError(
        "bad_request:database",
        "Failed to prepare user record"
      );
    }

    return;
  }
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

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown) {
  return Boolean(value);
}

function toNumber(value: unknown, fallback = 0) {
  return typeof value === "number" ? value : Number(value ?? fallback);
}

function toStringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map(String) : null;
}

function toSuggestedEdges(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const type = toNullableString(record.type);

    if (!type) {
      return [];
    }

    const edge: SuggestedEdge = { type };
    const targetDecisionId = toNullableString(record.target_decision_id);

    if (targetDecisionId) {
      edge.targetDecisionId = targetDecisionId;
    }

    return [edge];
  });
}

function mapProject(row: DatabaseRecord): WorkspaceProject {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapTopic(row: DatabaseRecord): WorkspaceTopic {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    label: String(row.label),
    isGeneral: toBoolean(row.is_general),
    archivedAt: toNullableString(row.archived_at),
    position: toNumber(row.position),
    createdAt: toIsoString(row.created_at),
  };
}

function mapConversation(row: DatabaseRecord): WorkspaceConversation {
  return {
    id: String(row.id),
    topicId: String(row.topic_id),
    projectId: String(row.project_id),
    endedAt: toNullableString(row.ended_at),
    createdAt: toIsoString(row.created_at),
  };
}

function mapMessage(row: DatabaseRecord): WorkspaceMessageRecord {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    topicId: String(row.topic_id),
    projectId: String(row.project_id),
    role: String(row.role) as WorkspaceMessageRecord["role"],
    content: String(row.content ?? ""),
    model: toNullableString(row.model),
    createdAt: toIsoString(row.created_at),
  };
}

function mapDecision(row: DatabaseRecord): WorkspaceDecision {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    topicId: String(row.topic_id),
    title: String(row.title),
    content: String(row.content),
    rationale: toNullableString(row.rationale),
    kind: String(row.kind ?? "plan"),
    weight: String(row.weight ?? "normal"),
    status: String(row.status ?? "active"),
    sensitivity: String(row.sensitivity ?? "normal"),
    relevantMessageIds: toStringArray(row.relevant_message_ids),
    createdFromMessageId: toNullableString(row.created_from_message_id),
    confirmedByUserId: toNullableString(row.confirmed_by_user_id),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapEdge(row: DatabaseRecord): WorkspaceEdge {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    topicId: String(row.topic_id),
    sourceDecisionId: String(row.source_decision_id),
    targetDecisionId: String(row.target_decision_id),
    type: String(row.type),
    createdAt: toIsoString(row.created_at),
  };
}

function mapCandidate(row: DatabaseRecord): WorkspaceCandidateDecision {
  const confidenceValue =
    typeof row.confidence === "number"
      ? row.confidence
      : row.confidence === null || row.confidence === undefined
        ? null
        : Number(row.confidence);

  return {
    id: String(row.id),
    projectId: String(row.project_id),
    topicId: String(row.topic_id),
    conversationId: toNullableString(row.conversation_id),
    messageId: toNullableString(row.message_id),
    proposedTitle: toNullableString(row.proposed_title),
    proposedContent: String(row.proposed_content),
    proposedRationale: toNullableString(row.proposed_rationale),
    proposedKind: toNullableString(row.proposed_kind),
    proposedWeight: toNullableString(row.proposed_weight),
    confidence: Number.isNaN(confidenceValue) ? null : confidenceValue,
    preSelected: toBoolean(row.pre_selected),
    status: String(row.status ?? "pending"),
    suggestedEdges: toSuggestedEdges(row.suggested_edges),
    relevantMessageIds: toStringArray(row.relevant_message_ids),
    contentHash: toNullableString(row.content_hash),
    resolvedAt: toNullableString(row.resolved_at),
    resolvedDecisionId: toNullableString(row.resolved_decision_id),
    source: String(row.source ?? "zeno_extraction"),
    sourceMetadata:
      row.source_metadata && typeof row.source_metadata === "object"
        ? (row.source_metadata as Record<string, unknown>)
        : null,
    externalEvidence: toNullableString(row.external_evidence),
    createdAt: toIsoString(row.created_at),
  };
}

function sortTopics(topics: WorkspaceTopic[]) {
  return [...topics].sort((left, right) => {
    if (left.isGeneral !== right.isGeneral) {
      return left.isGeneral ? -1 : 1;
    }

    if (left.archivedAt !== right.archivedAt) {
      return left.archivedAt ? 1 : -1;
    }

    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

export async function listProjectsByUserId(userId: string) {
  const client = getClient();
  const rows = await ensureResult(
    client
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    "Failed to list projects"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapProject(row));
}

export async function listProjectSummariesByUserId(
  userId: string
): Promise<WorkspaceProjectSummary[]> {
  const client = getClient();
  const projectRows = await ensureResult(
    client
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    "Failed to list project summaries"
  );

  const projects = (projectRows ?? []).map((row: DatabaseRecord) =>
    mapProject(row)
  );

  if (projects.length === 0) {
    return [];
  }

  const topicRows = await ensureResult(
    client
      .from("topics")
      .select("*")
      .in(
        "project_id",
        projects.map((project: WorkspaceProject) => project.id)
      )
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    "Failed to count project topics"
  );

  const topicCounts = new Map<string, number>();
  const primaryTopicIds = new Map<string, string>();
  const primaryTopicArchivedStates = new Map<string, boolean>();

  for (const row of topicRows ?? []) {
    const topic = mapTopic(row as DatabaseRecord);
    const projectId = topic.projectId;
    topicCounts.set(projectId, (topicCounts.get(projectId) ?? 0) + 1);

    const currentPrimaryIsArchived =
      primaryTopicArchivedStates.get(projectId) ?? true;

    if (
      !primaryTopicIds.has(projectId) ||
      (currentPrimaryIsArchived && !topic.archivedAt)
    ) {
      primaryTopicIds.set(projectId, topic.id);
      primaryTopicArchivedStates.set(projectId, Boolean(topic.archivedAt));
    }
  }

  return projects.map((project: WorkspaceProject) => ({
    ...project,
    primaryTopicId: primaryTopicIds.get(project.id) ?? null,
    topicCount: topicCounts.get(project.id) ?? 0,
  }));
}

export async function getProjectByIdForUser(projectId: string, userId: string) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
    "Failed to load project"
  );

  return row ? mapProject(row as DatabaseRecord) : null;
}

export async function createProjectForUser({
  userId,
  userEmail,
  name,
}: {
  userId: string;
  userEmail?: string | null;
  name: string;
}) {
  const client = getClient();
  const payload = {
    user_id: userId,
    name,
  };
  let result = await client
    .from("projects")
    .insert(payload)
    .select("*")
    .single();

  if (result.error && isLegacyUserForeignKeyError(result.error)) {
    await ensureLegacyWorkspaceUserRecord({
      userId,
      userEmail,
    });
    result = await client.from("projects").insert(payload).select("*").single();
  }

  const row = await ensureResult(
    Promise.resolve(result),
    "Failed to create project",
    {
      operation: "create_project",
      table: "projects",
      payload,
    }
  );

  return mapProject(row as DatabaseRecord);
}

export async function listTopicsByProjectId(projectId: string) {
  const client = getClient();
  const rows = await ensureResult(
    client
      .from("topics")
      .select("*")
      .eq("project_id", projectId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    "Failed to list topics"
  );

  return sortTopics((rows ?? []).map((row: DatabaseRecord) => mapTopic(row)));
}

export async function getTopicByIdForUser(topicId: string, userId: string) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("topics")
      .select("*, projects!inner(user_id)")
      .eq("id", topicId)
      .eq("projects.user_id", userId)
      .maybeSingle(),
    "Failed to load topic"
  );

  return row ? mapTopic(row as DatabaseRecord) : null;
}

export async function createTopicForProject({
  projectId,
  label,
  isGeneral = false,
  position,
}: {
  projectId: string;
  label: string;
  isGeneral?: boolean;
  position?: number;
}) {
  const client = getClient();
  let nextPosition = position;

  if (typeof nextPosition !== "number") {
    const existing = await ensureResult(
      client
        .from("topics")
        .select("position")
        .eq("project_id", projectId)
        .order("position", { ascending: false })
        .limit(1),
      "Failed to load topic position"
    );

    const highestPosition = existing?.[0]?.position;
    nextPosition =
      typeof highestPosition === "number"
        ? highestPosition + 1
        : Number(highestPosition ?? 0) + 1;
  }

  const row = await ensureResult(
    client
      .from("topics")
      .insert({
        project_id: projectId,
        label,
        is_general: isGeneral,
        position: isGeneral ? 0 : nextPosition,
      })
      .select("*")
      .single(),
    "Failed to create topic",
    {
      operation: "create_topic",
      table: "topics",
      payload: {
        projectId,
        label,
        isGeneral,
        position: isGeneral ? 0 : nextPosition,
      },
    }
  );

  return mapTopic(row as DatabaseRecord);
}

export async function archiveTopicById(topicId: string) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("topics")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", topicId)
      .select("*")
      .single(),
    "Failed to archive topic"
  );

  return mapTopic(row as DatabaseRecord);
}

export async function listConversationsByTopicId(topicId: string) {
  const client = getClient();
  const rows = await ensureResult(
    client
      .from("conversations")
      .select("*")
      .eq("topic_id", topicId)
      .order("created_at", { ascending: true }),
    "Failed to list conversations"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapConversation(row));
}

export async function getConversationByIdForUser(
  conversationId: string,
  userId: string
) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("conversations")
      .select("*, projects!inner(user_id)")
      .eq("id", conversationId)
      .eq("projects.user_id", userId)
      .maybeSingle(),
    "Failed to load conversation"
  );

  return row ? mapConversation(row as DatabaseRecord) : null;
}

export async function createConversation({
  id,
  topicId,
  projectId,
}: {
  id?: string;
  topicId: string;
  projectId: string;
}) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("conversations")
      .insert({
        ...(id ? { id } : {}),
        topic_id: topicId,
        project_id: projectId,
      })
      .select("*")
      .single(),
    "Failed to create conversation",
    {
      operation: "create_conversation",
      table: "conversations",
      payload: {
        id: id ?? null,
        topicId,
        projectId,
      },
    }
  );

  return mapConversation(row as DatabaseRecord);
}

export async function endConversation(conversationId: string) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("conversations")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", conversationId)
      .select("*")
      .single(),
    "Failed to end conversation"
  );

  return mapConversation(row as DatabaseRecord);
}

export async function saveWorkspaceMessages(
  messages: InsertWorkspaceMessage[]
) {
  if (messages.length === 0) {
    return [];
  }

  const client = getClient();
  const rows = await ensureResult(
    client
      .from("messages")
      .upsert(
        messages.map((message) => ({
          id: message.id,
          conversation_id: message.conversationId,
          topic_id: message.topicId,
          project_id: message.projectId,
          role: message.role,
          content: message.content,
          model: message.model ?? null,
          created_at: message.createdAt ?? new Date().toISOString(),
        })),
        { onConflict: "id" }
      )
      .select("*"),
    "Failed to save workspace messages"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapMessage(row));
}

export async function listWorkspaceMessagesByConversationId(
  conversationId: string
) {
  const client = getClient();
  const rows = await ensureResult(
    client
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    "Failed to list workspace messages"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapMessage(row));
}

export async function listWorkspaceMessagesByIds(messageIds: string[]) {
  if (messageIds.length === 0) {
    return [];
  }

  const client = getClient();
  const rows = await ensureResult(
    client
      .from("messages")
      .select("*")
      .in("id", messageIds)
      .order("created_at", { ascending: true }),
    "Failed to load workspace messages"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapMessage(row));
}

export async function listRecentWorkspaceMessagesByConversationId(
  conversationId: string,
  limit = 20
) {
  const client = getClient();
  const rows = await ensureResult(
    client
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Failed to list recent workspace messages"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapMessage(row)).reverse();
}

export async function listPendingCandidateCountsByProjectId(projectId: string) {
  const client = getClient();
  const rows = await ensureResult(
    client
      .from("candidate_decisions")
      .select("topic_id")
      .eq("project_id", projectId)
      .eq("status", "pending"),
    "Failed to load candidate counts"
  );

  return ((rows ?? []) as DatabaseRecord[]).reduce<PendingCandidateCounts>(
    (counts, row: DatabaseRecord) => {
      const topicId = String(row.topic_id);
      counts[topicId] = (counts[topicId] ?? 0) + 1;
      return counts;
    },
    {}
  );
}

export function listPendingCandidatesByTopicId(topicId: string) {
  return listCandidatesByTopicId(topicId, {
    statuses: ["pending"],
  });
}

export async function listCandidatesByTopicId(
  topicId: string,
  options?: {
    source?: string;
    statuses?: string[];
    limit?: number;
  }
) {
  const client = getClient();
  let query = client
    .from("candidate_decisions")
    .select("*")
    .eq("topic_id", topicId);

  if (options?.source) {
    query = query.eq("source", options.source);
  }

  if (options?.statuses?.length === 1) {
    query = query.eq("status", options.statuses[0]);
  } else if (options?.statuses && options.statuses.length > 1) {
    query = query.in("status", options.statuses);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await ensureResult(
    query.order("created_at", { ascending: false }),
    "Failed to list topic candidates"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapCandidate(row));
}

export async function listCandidatesByMessageId(messageId: string) {
  const client = getClient();
  const rows = await ensureResult(
    client
      .from("candidate_decisions")
      .select("*")
      .eq("message_id", messageId)
      .order("created_at", { ascending: false }),
    "Failed to list message candidates"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapCandidate(row));
}

export async function getCandidateByContentHash({
  conversationId,
  contentHash,
}: {
  conversationId: string;
  contentHash: string;
}) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("candidate_decisions")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("content_hash", contentHash)
      .maybeSingle(),
    "Failed to load candidate by content hash"
  );

  return row ? mapCandidate(row as DatabaseRecord) : null;
}

export async function insertCandidateDecisions(
  candidates: InsertCandidateDecision[]
) {
  if (candidates.length === 0) {
    return [];
  }

  const client = getClient();
  const baseRows = candidates.map((candidate) => ({
    project_id: candidate.projectId,
    topic_id: candidate.topicId,
    conversation_id: candidate.conversationId ?? null,
    message_id: candidate.messageId ?? null,
    proposed_title: candidate.proposedTitle ?? null,
    proposed_content: candidate.proposedContent,
    proposed_rationale: candidate.proposedRationale ?? null,
    proposed_kind: candidate.proposedKind ?? "plan",
    proposed_weight: candidate.proposedWeight ?? "normal",
    confidence: candidate.confidence ?? null,
    pre_selected: candidate.preSelected ?? true,
    status: "pending",
    suggested_edges:
      candidate.suggestedEdges?.map((edge) => ({
        type: edge.type,
        ...(edge.targetDecisionId
          ? { target_decision_id: edge.targetDecisionId }
          : {}),
      })) ?? null,
    relevant_message_ids: candidate.relevantMessageIds ?? null,
    content_hash: candidate.contentHash ?? null,
    source: candidate.source ?? "zeno_extraction",
    source_metadata: candidate.sourceMetadata ?? null,
    external_evidence: candidate.externalEvidence ?? null,
  }));

  let rows: any = null;
  let error: { message?: string } | null = null;

  {
    const result = await client
      .from("candidate_decisions")
      .insert(baseRows)
      .select("*");

    rows = result.data;
    error = result.error;
  }

  if (
    error?.message?.includes("candidate_decisions") &&
    error.message.includes("schema cache")
  ) {
    const legacyRows = baseRows.map(
      ({
        source: _source,
        source_metadata: _sourceMetadata,
        external_evidence: _externalEvidence,
        ...legacyRow
      }) => legacyRow
    );
    const legacyResult = await client
      .from("candidate_decisions")
      .insert(legacyRows)
      .select("*");

    rows = legacyResult.data;
    error = legacyResult.error;
  }

  if (error) {
    console.error("Failed to insert candidates", error);
    throw new ChatbotError(
      "bad_request:database",
      "Failed to insert candidates"
    );
  }

  return (rows ?? []).map((row: DatabaseRecord) => mapCandidate(row));
}

export async function listDecisionsByTopicId(topicId: string) {
  const client = getClient();
  const rows = await ensureResult(
    client
      .from("decisions")
      .select("*")
      .eq("topic_id", topicId)
      .order("updated_at", { ascending: false }),
    "Failed to list decisions"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapDecision(row));
}

export async function getDecisionByIdForUser(
  decisionId: string,
  userId: string
) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("decisions")
      .select("*, projects!inner(user_id)")
      .eq("id", decisionId)
      .eq("projects.user_id", userId)
      .maybeSingle(),
    "Failed to load decision"
  );

  return row ? mapDecision(row as DatabaseRecord) : null;
}

export async function listEdgesByTopicId(topicId: string) {
  const client = getClient();
  const rows = await ensureResult(
    client
      .from("edges")
      .select("*")
      .eq("topic_id", topicId)
      .order("created_at", { ascending: true }),
    "Failed to list edges"
  );

  return (rows ?? []).map((row: DatabaseRecord) => mapEdge(row));
}

export async function insertDecision(decisionInput: InsertDecision) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("decisions")
      .insert({
        project_id: decisionInput.projectId,
        topic_id: decisionInput.topicId,
        title: decisionInput.title,
        content: decisionInput.content,
        rationale: decisionInput.rationale ?? null,
        kind: decisionInput.kind ?? "plan",
        weight: decisionInput.weight ?? "normal",
        status: decisionInput.status ?? "active",
        sensitivity: decisionInput.sensitivity ?? "normal",
        relevant_message_ids: decisionInput.relevantMessageIds ?? null,
        created_from_message_id: decisionInput.createdFromMessageId ?? null,
        confirmed_by_user_id: decisionInput.confirmedByUserId ?? null,
      })
      .select("*")
      .single(),
    "Failed to insert decision",
    {
      operation: "insert_decision",
      table: "decisions",
      payload: {
        projectId: decisionInput.projectId,
        topicId: decisionInput.topicId,
        title: decisionInput.title,
        kind: decisionInput.kind ?? "plan",
        status: decisionInput.status ?? "active",
      },
    }
  );

  return mapDecision(row as DatabaseRecord);
}

export async function insertEdge(edgeInput: InsertEdge) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("edges")
      .insert({
        project_id: edgeInput.projectId,
        topic_id: edgeInput.topicId,
        source_decision_id: edgeInput.sourceDecisionId,
        target_decision_id: edgeInput.targetDecisionId,
        type: edgeInput.type,
      })
      .select("*")
      .single(),
    "Failed to insert edge"
  );

  return mapEdge(row as DatabaseRecord);
}

export async function updateDecisionStatus({
  decisionId,
  status,
}: {
  decisionId: string;
  status: string;
}) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("decisions")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", decisionId)
      .select("*")
      .single(),
    "Failed to update decision"
  );

  return mapDecision(row as DatabaseRecord);
}

export async function updateCandidateResolution({
  candidateId,
  status,
  resolvedDecisionId,
}: {
  candidateId: string;
  status: string;
  resolvedDecisionId?: string | null;
}) {
  const client = getClient();
  const row = await ensureResult(
    client
      .from("candidate_decisions")
      .update({
        status,
        resolved_decision_id: resolvedDecisionId ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", candidateId)
      .select("*")
      .single(),
    "Failed to update candidate resolution"
  );

  return mapCandidate(row as DatabaseRecord);
}

export async function insertDecisionLog(entry: InsertDecisionLog) {
  const client = getClient();
  await ensureResult(
    client.from("decision_log").insert({
      decision_id: entry.decisionId ?? null,
      candidate_id: entry.candidateId ?? null,
      action: entry.action,
      actor_type: entry.actorType ?? "user",
      metadata: entry.metadata ?? null,
    }),
    "Failed to insert decision log"
  );
}
