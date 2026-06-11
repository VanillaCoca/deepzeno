import "server-only";

import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getProjectByIdForUser,
  getTopicByIdForUser,
} from "@/lib/workspace/queries";
import {
  validateImportedIRCreation,
  validateStandardIRCreation,
} from "./creation-guards";
import type { ImportConfirmRow, ImportStatus } from "./import-types";
import {
  getIRPrefix,
  type IRCreatedBy,
  type IRDetail,
  type IREdge,
  type IRKind,
  type IRNode,
  type IRPlanSubtype,
  type IRRelation,
  type IRRelationInput,
  type IRSourceLayer,
  type IRStatus,
  normalizeIRTitle,
  validateIRKindSubtype,
} from "./types";

type DatabaseRecord = Record<string, unknown>;

type DatabaseErrorLike = {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
};

type SupabaseResult<T = unknown> = {
  data: T;
  error: DatabaseErrorLike | null;
};

export class IRConflictError extends Error {
  statusCode = 409;
}

export class IRNotReadyError extends Error {
  statusCode = 503;
}

export class IRImportPartialFailureError extends Error {
  statusCode = 500;
  readonly persistedRows: IRNode[];

  constructor(message: string, persistedRows: IRNode[]) {
    super(message);
    this.persistedRows = persistedRows;
  }
}

function getClient(): any {
  return getSupabaseAdminClient() as any;
}

function isMissingIRTableError(error: DatabaseErrorLike | null | undefined) {
  return (
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table") === true ||
    error?.message?.includes("schema cache") === true
  );
}

async function ensureResult<T>(
  promise: PromiseLike<SupabaseResult<T>>,
  message: string
) {
  const { data, error } = await promise;

  if (error) {
    if (isMissingIRTableError(error)) {
      throw new IRNotReadyError("IR schema has not been migrated yet.");
    }

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

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

function mapIRNode(row: DatabaseRecord): IRNode {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    topicId: toNullableString(row.topic_id),
    parentId: toNullableString(row.parent_id),
    kind: String(row.kind) as IRKind,
    subtype: toNullableString(row.subtype) as IRPlanSubtype | null,
    status: String(row.status) as IRStatus,
    title: String(row.title),
    content: toNullableString(row.content),
    rationale: toNullableString(row.rationale),
    sensitivity: String(row.sensitivity ?? "normal") as "normal" | "vault",
    sourceChatId: toNullableString(row.source_chat_id),
    sourceTurnId: toNullableString(row.source_turn_id),
    sourceTextSpan: toNullableString(row.source_text_span),
    sourceLayer: toNullableString(row.source_layer) as IRSourceLayer | null,
    importSessionId: toNullableString(row.import_session_id),
    reactivationAnchorId: toNullableString(row.reactivation_anchor_id),
    extractionConfidence: toNullableNumber(row.extraction_confidence),
    createdAt: toIsoString(row.created_at),
    promotedToPendingAt: toNullableString(row.promoted_to_pending_at),
    confirmedAt: toNullableString(row.confirmed_at),
    supersededAt: toNullableString(row.superseded_at),
    supersededBy: toNullableString(row.superseded_by),
    createdBy: String(row.created_by) as IRCreatedBy,
    confirmedBy: toNullableString(row.confirmed_by),
  };
}

function mapIREdge(row: DatabaseRecord): IREdge {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    fromNode: String(row.from_node),
    toNode: String(row.to_node),
    relation: String(row.relation) as IRRelation,
    status: String(row.status ?? "pending") as IREdge["status"],
    isAnchorHint: Boolean(row.is_anchor_hint),
    createdAt: toIsoString(row.created_at),
    confirmedAt: toNullableString(row.confirmed_at),
  };
}

async function assertProjectAccess(userId: string, projectId: string) {
  const project = await getProjectByIdForUser(projectId, userId);

  if (!project) {
    throw new ChatbotError("forbidden:chat", "Project not found");
  }

  return project;
}

async function assertTopicAccess({
  userId,
  projectId,
  topicId,
}: {
  userId: string;
  projectId: string;
  topicId?: string | null;
}) {
  if (!topicId) {
    return null;
  }

  const topic = await getTopicByIdForUser(topicId, userId);

  if (!topic || topic.projectId !== projectId) {
    throw new ChatbotError("forbidden:chat", "Topic not found");
  }

  return topic;
}

async function listNodesByIds(ids: string[]) {
  if (ids.length === 0) {
    return [];
  }

  const rows = await ensureResult<DatabaseRecord[]>(
    getClient().from("ir_nodes").select("*").in("id", ids),
    "Failed to load IR related nodes"
  );

  return (rows ?? []).map(mapIRNode);
}

export async function getNextIRId({
  kind,
  subtype,
}: {
  kind: IRKind;
  subtype?: IRPlanSubtype | null;
}) {
  const prefix = getIRPrefix(kind, subtype);
  const rows = await ensureResult<DatabaseRecord[]>(
    getClient().from("ir_nodes").select("id").like("id", `${prefix}%`),
    "Failed to generate IR id"
  );
  let max = 0;

  for (const row of rows ?? []) {
    const id = String(row.id);
    const match = id.match(new RegExp(`^${prefix}(\\d+)$`));

    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }

  return `${prefix}${max + 1}`;
}

export async function findDuplicateIRCandidate({
  projectId,
  kind,
  subtype,
  title,
}: {
  projectId: string;
  kind: IRKind;
  subtype?: IRPlanSubtype | null;
  title: string;
}) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let query = getClient()
    .from("ir_nodes")
    .select("*")
    .eq("project_id", projectId)
    .eq("kind", kind)
    .in("status", ["pending", "idea"])
    .gte("created_at", since);

  query =
    subtype === null || subtype === undefined
      ? query.is("subtype", null)
      : query.eq("subtype", subtype);

  const rows = await ensureResult<DatabaseRecord[]>(
    query,
    "Failed to inspect duplicate IR candidates"
  );
  const normalizedTitle = normalizeIRTitle(title);

  return (
    (rows ?? [])
      .map(mapIRNode)
      .find((node) => normalizeIRTitle(node.title) === normalizedTitle) ?? null
  );
}

async function validateRelationTargets({
  projectId,
  relations,
}: {
  projectId: string;
  relations: IRRelationInput[];
}) {
  for (const relation of relations) {
    const target = await getIRNodeById(relation.toNode);

    if (!target || target.projectId !== projectId) {
      throw new ChatbotError(
        "bad_request:api",
        "IR relation target does not exist in this project"
      );
    }
  }
}

export async function getIRNodeById(id: string) {
  const row = await ensureResult<DatabaseRecord | null>(
    getClient().from("ir_nodes").select("*").eq("id", id).maybeSingle(),
    "Failed to load IR node"
  );

  return row ? mapIRNode(row) : null;
}

export async function getIRNodeForUser({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  const node = await getIRNodeById(id);

  if (!node) {
    return null;
  }

  await assertProjectAccess(userId, node.projectId);
  return node;
}

export async function getIRDetailForUser({
  id,
  userId,
}: {
  id: string;
  userId: string;
}): Promise<IRDetail | null> {
  const node = await getIRNodeForUser({ id, userId });

  if (!node) {
    return null;
  }

  const edgeRows = await ensureResult<DatabaseRecord[]>(
    getClient()
      .from("ir_edges")
      .select("*")
      .eq("project_id", node.projectId)
      .or(`from_node.eq.${id},to_node.eq.${id}`)
      .order("created_at", { ascending: true }),
    "Failed to load IR detail edges"
  );
  const edges = (edgeRows ?? []).map(mapIREdge);
  const relatedIds = [
    ...new Set(
      edges
        .flatMap((edge) => [edge.fromNode, edge.toNode])
        .filter((nodeId) => nodeId !== id)
    ),
  ];

  return {
    node,
    edges,
    relatedNodes: await listNodesByIds(relatedIds),
  };
}

export async function listIRNodesForUser({
  userId,
  projectId,
  topicId,
  unassigned = false,
  status,
  kind,
  subtype,
  query: searchQuery,
}: {
  userId: string;
  projectId: string;
  topicId?: string | null;
  unassigned?: boolean;
  status?: IRStatus | null;
  kind?: IRKind | null;
  subtype?: IRPlanSubtype | null;
  query?: string | null;
}) {
  await assertProjectAccess(userId, projectId);

  if (topicId && !unassigned) {
    await assertTopicAccess({ userId, projectId, topicId });
  }

  let query = getClient()
    .from("ir_nodes")
    .select("*")
    .eq("project_id", projectId);

  if (status) {
    query = query.eq("status", status);
  } else {
    query = query.eq("status", "active");
  }

  if (unassigned) {
    query = query.is("topic_id", null);
  } else if (topicId) {
    query = query.eq("topic_id", topicId);
  }

  if (kind) {
    query = query.eq("kind", kind);
  }

  if (subtype === null) {
    query = query.is("subtype", null);
  } else if (subtype) {
    query = query.eq("subtype", subtype);
  }

  if (searchQuery?.trim()) {
    const term = searchQuery.trim().replaceAll("%", "\\%");
    query = query.or(
      `title.ilike.%${term}%,content.ilike.%${term}%,rationale.ilike.%${term}%`
    );
  }

  const rows = await ensureResult<DatabaseRecord[]>(
    query.order("created_at", { ascending: false }),
    "Failed to list IR nodes"
  );

  return (rows ?? []).map(mapIRNode);
}

export async function countIRNodesByStatus({
  projectId,
  status,
  createdBy,
}: {
  projectId: string;
  status: IRStatus;
  createdBy?: IRCreatedBy;
}) {
  let query = getClient()
    .from("ir_nodes")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", status);

  if (createdBy) {
    query = query.eq("created_by", createdBy);
  }

  const { count, error } = await query;

  if (error) {
    if (isMissingIRTableError(error)) {
      throw new IRNotReadyError("IR schema has not been migrated yet.");
    }

    throw new ChatbotError("bad_request:database", "Failed to count IR nodes");
  }

  return count ?? 0;
}

export async function listIREdgesForProject({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}) {
  await assertProjectAccess(userId, projectId);
  const rows = await ensureResult<DatabaseRecord[]>(
    getClient()
      .from("ir_edges")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    "Failed to list IR edges"
  );

  return (rows ?? []).map(mapIREdge);
}

export async function createIRNodeForUser({
  userId,
  projectId,
  topicId,
  kind,
  subtype = null,
  title,
  content = null,
  rationale = null,
  sourceChatId = null,
  sourceTurnId = null,
  sourceTextSpan = null,
  sourceLayer,
  createdBy,
  initialStatus,
  extractionConfidence = null,
  reactivationAnchorId = null,
  sensitivity = "normal",
  relations = [],
}: {
  userId: string;
  projectId: string;
  topicId?: string | null;
  kind: IRKind;
  subtype?: IRPlanSubtype | null;
  title: string;
  content?: string | null;
  rationale?: string | null;
  sourceChatId?: string | null;
  sourceTurnId?: string | null;
  sourceTextSpan?: string | null;
  sourceLayer: IRSourceLayer;
  createdBy: IRCreatedBy;
  initialStatus: "pending" | "idea";
  extractionConfidence?: number | null;
  reactivationAnchorId?: string | null;
  sensitivity?: "normal" | "vault";
  relations?: IRRelationInput[];
}) {
  await assertProjectAccess(userId, projectId);
  await assertTopicAccess({ userId, projectId, topicId });

  if (!validateIRKindSubtype(kind, subtype)) {
    throw new ChatbotError("bad_request:api", "Invalid IR kind/subtype");
  }

  const creationGuard = validateStandardIRCreation({
    sourceLayer,
    initialStatus,
  });

  if (!creationGuard.ok) {
    throw new ChatbotError("bad_request:api", creationGuard.message);
  }

  await validateRelationTargets({ projectId, relations });

  if (reactivationAnchorId) {
    const anchor = await getIRNodeById(reactivationAnchorId);

    if (!anchor || anchor.projectId !== projectId) {
      throw new ChatbotError("bad_request:api", "Invalid reactivation anchor");
    }
  }

  const trimmedTitle = title.trim().slice(0, 200);
  const nodeId = await getNextIRId({ kind, subtype });
  const row = await ensureResult<DatabaseRecord>(
    getClient()
      .from("ir_nodes")
      .insert({
        id: nodeId,
        project_id: projectId,
        topic_id: topicId ?? null,
        kind,
        subtype,
        status: initialStatus,
        title: trimmedTitle,
        content,
        rationale,
        sensitivity,
        source_chat_id: sourceChatId,
        source_turn_id: sourceTurnId,
        source_text_span: sourceTextSpan,
        source_layer: sourceLayer,
        created_by: createdBy,
        extraction_confidence: extractionConfidence,
        reactivation_anchor_id: reactivationAnchorId,
      })
      .select("*")
      .single(),
    "Failed to create IR node"
  );
  const node = mapIRNode(row);

  if (relations.length > 0) {
    await ensureResult(
      getClient()
        .from("ir_edges")
        .insert(
          relations.map((relation) => ({
            project_id: projectId,
            from_node: node.id,
            to_node: relation.toNode,
            relation: relation.relation,
            status: "pending",
            is_anchor_hint: Boolean(relation.isAnchorHint),
          }))
        ),
      "Failed to create IR relations"
    );
  }

  await logIREvent({
    projectId,
    topicId: topicId ?? null,
    nodeId: node.id,
    event: initialStatus === "idea" ? "idea_created" : "candidate_created",
    layer: sourceLayer,
    metadata: { kind, subtype, createdBy },
  });

  return node;
}

export async function createImportedIRNodesForUser({
  userId,
  projectId,
  topicId,
  importSessionId,
  rows,
  confirmationSource,
}: {
  userId: string;
  projectId: string;
  topicId?: string | null;
  importSessionId: string;
  rows: ImportConfirmRow[];
  confirmationSource?: "review_truth_row";
}) {
  await assertProjectAccess(userId, projectId);
  await assertTopicAccess({ userId, projectId, topicId });

  if (!importSessionId) {
    throw new ChatbotError("bad_request:api", "import_session_id is required");
  }

  for (const row of rows) {
    if (row.action_state === "dismissed") {
      continue;
    }

    if (!validateIRKindSubtype(row.kind, row.subtype)) {
      throw new ChatbotError("bad_request:api", "Invalid IR kind/subtype");
    }

    if (!row.source_text_span.trim()) {
      throw new ChatbotError("bad_request:api", "source_text_span is required");
    }

    // Constitution 2c: truth is only written through per-row review.
    if (
      row.final_status === "active" &&
      confirmationSource !== "review_truth_row"
    ) {
      throw new ChatbotError(
        "bad_request:api",
        "Truth rows require individual review confirmation"
      );
    }

    if (row.final_status === "active" && !topicId) {
      throw new ChatbotError(
        "bad_request:api",
        "Active IR must be assigned to a topic"
      );
    }

    const importGuard = validateImportedIRCreation({
      sourceLayer: "manual",
      createdBy: "user",
      status: row.final_status as ImportStatus,
      importSessionId,
    });

    if (!importGuard.ok) {
      throw new ChatbotError("bad_request:api", importGuard.message);
    }
  }

  const now = new Date().toISOString();
  const persistedRows: IRNode[] = [];

  try {
    for (const row of rows) {
      if (row.action_state === "dismissed") {
        continue;
      }

      const existingRow = await ensureResult<DatabaseRecord | null>(
        getClient()
          .from("ir_nodes")
          .select("*")
          .eq("project_id", projectId)
          .eq("import_session_id", importSessionId)
          .eq("source_text_span", row.source_text_span)
          .maybeSingle(),
        "Failed to inspect imported IR retry state"
      );

      if (existingRow) {
        persistedRows.push(mapIRNode(existingRow));
        continue;
      }

      const nodeId = await getNextIRId({
        kind: row.kind,
        subtype: row.subtype,
      });
      const isActive = row.final_status === "active";
      const inserted = await ensureResult<DatabaseRecord>(
        getClient()
          .from("ir_nodes")
          .insert({
            id: nodeId,
            project_id: projectId,
            topic_id: topicId ?? null,
            kind: row.kind,
            subtype: row.subtype,
            status: row.final_status,
            title: row.title.trim().slice(0, 200),
            content: row.content,
            rationale: row.rationale,
            sensitivity: "normal",
            source_text_span: row.source_text_span,
            source_layer: "manual",
            import_session_id: importSessionId,
            created_by: "user",
            confirmed_at: isActive ? now : null,
            confirmed_by: isActive ? userId : null,
          })
          .select("*")
          .single(),
        "Failed to create imported IR node"
      );
      const node = mapIRNode(inserted);
      persistedRows.push(node);

      await logIREvent({
        projectId,
        topicId: topicId ?? null,
        nodeId: node.id,
        event: "import_row_action",
        layer: "manual",
        metadata: {
          importSessionId,
          clientId: row.client_id,
          status: row.final_status,
          actionState: row.action_state,
          confirmationSource: isActive ? confirmationSource : null,
        },
      });
    }
  } catch (error) {
    throw new IRImportPartialFailureError(
      error instanceof Error ? error.message : "Import persistence failed",
      persistedRows
    );
  }

  return persistedRows;
}

export async function promoteIRNodeForUser({
  userId,
  id,
}: {
  userId: string;
  id: string;
}) {
  const node = await getIRNodeForUser({ id, userId });

  if (node?.status !== "idea") {
    throw new ChatbotError("bad_request:api", "IR node is not an idea");
  }

  const now = new Date().toISOString();
  const row = await ensureResult<DatabaseRecord>(
    getClient()
      .from("ir_nodes")
      .update({
        status: "pending",
        promoted_to_pending_at: now,
      })
      .eq("id", id)
      .eq("status", "idea")
      .select("*")
      .single(),
    "Failed to promote IR idea"
  );

  await logIREvent({
    projectId: node.projectId,
    topicId: node.topicId,
    nodeId: id,
    event: "idea_promoted",
    layer: "system",
  });

  return mapIRNode(row);
}

export async function confirmIRNodeForUser({
  userId,
  id,
  topicId,
  edits,
}: {
  userId: string;
  id: string;
  topicId?: string | null;
  edits?: Partial<
    Pick<
      IRNode,
      "title" | "content" | "rationale" | "kind" | "subtype" | "sensitivity"
    >
  >;
}) {
  const node = await getIRNodeForUser({ id, userId });

  if (!node || (node.status !== "pending" && node.status !== "idea")) {
    throw new IRConflictError("IR node is no longer confirmable.");
  }

  const assignedTopicId = topicId ?? node.topicId;

  if (!assignedTopicId) {
    throw new ChatbotError(
      "bad_request:api",
      "Unassigned IR must be assigned to a topic before confirmation"
    );
  }

  await assertTopicAccess({
    userId,
    projectId: node.projectId,
    topicId: assignedTopicId,
  });

  const kind = edits?.kind ?? node.kind;
  const subtype = edits?.subtype ?? node.subtype;

  if (!validateIRKindSubtype(kind, subtype)) {
    throw new ChatbotError("bad_request:api", "Invalid IR kind/subtype");
  }

  const now = new Date().toISOString();
  const updatePayload = {
    status: "active",
    confirmed_at: now,
    confirmed_by: userId,
    topic_id: assignedTopicId,
    ...(edits?.title ? { title: edits.title.trim().slice(0, 200) } : {}),
    ...(edits?.content === undefined ? {} : { content: edits.content }),
    ...(edits?.rationale === undefined ? {} : { rationale: edits.rationale }),
    ...(edits?.kind ? { kind } : {}),
    ...(edits?.subtype === undefined ? {} : { subtype }),
    ...(edits?.sensitivity ? { sensitivity: edits.sensitivity } : {}),
  };
  const row = await ensureResult<DatabaseRecord>(
    getClient()
      .from("ir_nodes")
      .update(updatePayload)
      .eq("id", id)
      .in("status", ["pending", "idea"])
      .select("*")
      .single(),
    "Failed to confirm IR node"
  );
  const confirmed = mapIRNode(row);

  const edgeRows = await ensureResult<DatabaseRecord[]>(
    getClient()
      .from("ir_edges")
      .select("*")
      .eq("project_id", node.projectId)
      .eq("from_node", id)
      .eq("status", "pending"),
    "Failed to load pending IR relations"
  );
  const edges = (edgeRows ?? []).map(mapIREdge);

  for (const edge of edges) {
    await ensureResult(
      getClient()
        .from("ir_edges")
        .update({ status: "active", confirmed_at: now })
        .eq("id", edge.id),
      "Failed to activate IR relation"
    );

    if (edge.relation === "supersedes") {
      await ensureResult(
        getClient()
          .from("ir_nodes")
          .update({
            status: "superseded",
            superseded_at: now,
            superseded_by: id,
          })
          .eq("id", edge.toNode)
          .eq("status", "active"),
        "Failed to supersede previous IR node"
      );
    }
  }

  await logIREvent({
    projectId: node.projectId,
    topicId: node.topicId,
    nodeId: id,
    event: "candidate_confirmed",
    layer: "system",
  });

  return confirmed;
}

export async function dismissIRNodeForUser({
  userId,
  id,
}: {
  userId: string;
  id: string;
}) {
  const node = await getIRNodeForUser({ id, userId });

  if (!node || (node.status !== "pending" && node.status !== "idea")) {
    throw new ChatbotError("bad_request:api", "IR node is not dismissible");
  }

  const row = await ensureResult<DatabaseRecord>(
    getClient()
      .from("ir_nodes")
      .update({ status: "dismissed" })
      .eq("id", id)
      .in("status", ["pending", "idea"])
      .select("*")
      .single(),
    "Failed to dismiss IR node"
  );

  await logIREvent({
    projectId: node.projectId,
    topicId: node.topicId,
    nodeId: id,
    event: "candidate_dismissed",
    layer: "system",
  });

  return mapIRNode(row);
}

export async function reclassifyIRNodeForUser({
  userId,
  id,
  kind,
  subtype,
}: {
  userId: string;
  id: string;
  kind: IRKind;
  subtype?: IRPlanSubtype | null;
}) {
  const node = await getIRNodeForUser({ id, userId });

  if (
    !node ||
    (node.status !== "pending" && node.status !== "idea") ||
    node.kind !== "unclassified"
  ) {
    throw new IRConflictError("IR node cannot be reclassified.");
  }

  if (!validateIRKindSubtype(kind, subtype ?? null)) {
    throw new ChatbotError("bad_request:api", "Invalid IR kind/subtype");
  }

  const newId = await getNextIRId({ kind, subtype: subtype ?? null });
  const row = await ensureResult<DatabaseRecord>(
    getClient()
      .from("ir_nodes")
      .update({
        id: newId,
        kind,
        subtype: subtype ?? null,
      })
      .eq("id", id)
      .in("status", ["pending", "idea"])
      .eq("kind", "unclassified")
      .select("*")
      .single(),
    "Failed to reclassify IR node"
  );

  await ensureResult(
    getClient()
      .from("ir_edges")
      .update({ from_node: newId })
      .eq("from_node", id),
    "Failed to reclassify outgoing IR edges"
  );
  await ensureResult(
    getClient().from("ir_edges").update({ to_node: newId }).eq("to_node", id),
    "Failed to reclassify incoming IR edges"
  );

  await logIREvent({
    projectId: node.projectId,
    topicId: node.topicId,
    nodeId: newId,
    event: "unclassified_reissued",
    layer: "manual",
    metadata: { oldId: id, newId, kind, subtype: subtype ?? null },
  });

  return { oldId: id, newId, node: mapIRNode(row) };
}

export async function createSupersedingIRNodeForUser({
  userId,
  id,
  title,
  content,
  rationale,
  kind,
  subtype,
}: {
  userId: string;
  id: string;
  title?: string;
  content?: string | null;
  rationale?: string | null;
  kind?: IRKind;
  subtype?: IRPlanSubtype | null;
}) {
  const source = await getIRNodeForUser({ id, userId });

  if (source?.status !== "active") {
    throw new ChatbotError(
      "bad_request:api",
      "Only active IR nodes can be superseded"
    );
  }

  return await createIRNodeForUser({
    userId,
    projectId: source.projectId,
    topicId: source.topicId,
    kind: kind ?? source.kind,
    subtype: subtype === undefined ? source.subtype : subtype,
    title: title?.trim() || `${source.title} (updated)`,
    content: content === undefined ? source.content : content,
    rationale: rationale === undefined ? source.rationale : rationale,
    sourceLayer: "manual",
    createdBy: "user",
    initialStatus: "pending",
    relations: [{ relation: "supersedes", toNode: source.id }],
  });
}

export async function saveIRSelectionForUser({
  userId,
  projectId,
  topicId,
  sourceChatId,
  sourceTurnId,
  sourceTextSpan,
  userKindChoice,
}: {
  userId: string;
  projectId: string;
  topicId?: string | null;
  sourceChatId?: string | null;
  sourceTurnId?: string | null;
  sourceTextSpan: string;
  userKindChoice?: { kind: IRKind; subtype?: IRPlanSubtype | null } | null;
}) {
  const selectedText = sourceTextSpan.trim();

  if (!selectedText) {
    throw new ChatbotError("bad_request:api", "selection_length must be > 0");
  }

  const kind = userKindChoice?.kind ?? "unclassified";
  const subtype =
    userKindChoice?.kind === "plan"
      ? (userKindChoice.subtype ?? "decision")
      : null;

  return await createIRNodeForUser({
    userId,
    projectId,
    topicId,
    kind,
    subtype,
    title: selectedText.slice(0, 200),
    content: selectedText,
    sourceChatId,
    sourceTurnId,
    sourceTextSpan: selectedText,
    sourceLayer: "manual",
    createdBy: "user",
    initialStatus: "pending",
  });
}

export async function upsertChatSessionSweepState({
  chatSessionId,
  lastSweepAtTurn = 0,
  reactivationAnchorId,
}: {
  chatSessionId: string;
  lastSweepAtTurn?: number;
  reactivationAnchorId?: string | null;
}) {
  await ensureResult(
    getClient()
      .from("chat_session_state")
      .upsert(
        {
          chat_session_id: chatSessionId,
          last_sweep_at_turn: lastSweepAtTurn,
          ...(reactivationAnchorId === undefined
            ? {}
            : { reactivation_anchor_id: reactivationAnchorId }),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "chat_session_id" }
      ),
    "Failed to update chat session IR state"
  );
}

export async function getChatSessionSweepState(chatSessionId: string) {
  const row = await ensureResult<DatabaseRecord | null>(
    getClient()
      .from("chat_session_state")
      .select("*")
      .eq("chat_session_id", chatSessionId)
      .maybeSingle(),
    "Failed to load chat session IR state"
  );

  if (!row) {
    return null;
  }

  return {
    chatSessionId: String(row.chat_session_id),
    reactivationAnchorId: toNullableString(row.reactivation_anchor_id),
    reactivationAnchorSetAtTurn: toNullableNumber(
      row.reactivation_anchor_set_at_turn
    ),
    lastSweepAtTurn: Number(row.last_sweep_at_turn ?? 0),
    updatedAt: toIsoString(row.updated_at),
  };
}

export type KickoffState = "none" | "intake" | "confirmed" | "skipped";

export async function getKickoffStateForProject(
  projectId: string
): Promise<KickoffState> {
  const rows = await ensureResult<DatabaseRecord[]>(
    getClient()
      .from("ir_extraction_events")
      .select("event")
      .eq("project_id", projectId)
      .in("event", [
        "kickoff_intake_seeded",
        "kickoff_confirmed",
        "kickoff_skipped",
      ]),
    "Failed to read kickoff state"
  );
  const events = new Set((rows ?? []).map((row) => String(row.event)));

  if (events.has("kickoff_confirmed")) {
    return "confirmed";
  }

  if (events.has("kickoff_skipped")) {
    return "skipped";
  }

  if (events.has("kickoff_intake_seeded")) {
    return "intake";
  }

  return "none";
}

export async function logIREvent({
  projectId,
  topicId = null,
  nodeId = null,
  edgeId = null,
  event,
  layer,
  metadata = null,
}: {
  projectId?: string | null;
  topicId?: string | null;
  nodeId?: string | null;
  edgeId?: string | null;
  event: string;
  layer: string;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await ensureResult(
      getClient().from("ir_extraction_events").insert({
        project_id: projectId,
        topic_id: topicId,
        node_id: nodeId,
        edge_id: edgeId,
        event,
        layer,
        metadata,
      }),
      "Failed to write IR telemetry"
    );
  } catch (error) {
    if (error instanceof IRNotReadyError) {
      return;
    }

    console.warn("IR telemetry write failed", error);
  }
}
