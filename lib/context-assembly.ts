import "server-only";

import {
  type ContextIREdge,
  type ContextIRNode,
  MAX_CONTEXT_CHARS,
  serializeIRWithinBudget,
} from "@/lib/context/truth-budget";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getProjectActiveTopicIds,
  resolveTopicContextIds,
} from "@/lib/topic-lifecycle";
import {
  listTopicRelationsByProjectId,
  listTopicsByProjectId,
} from "@/lib/workspace/queries";
import type {
  WorkspaceTopic,
  WorkspaceTopicRelation,
} from "@/lib/workspace/types";

type DatabaseRecord = Record<string, unknown>;

function getClient(): any {
  return getSupabaseAdminClient() as any;
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

function mapIRNode(row: DatabaseRecord): ContextIRNode {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    topicId: toNullableString(row.topic_id),
    kind: String(row.kind),
    subtype: toNullableString(row.subtype),
    title: String(row.title),
    content: toNullableString(row.content),
    rationale: toNullableString(row.rationale),
    createdAt: toIsoString(row.created_at),
  };
}

function mapIREdge(row: DatabaseRecord): ContextIREdge {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    fromNode: String(row.from_node),
    toNode: String(row.to_node),
    relation: String(row.relation),
    status: String(row.status ?? "pending"),
  };
}

function serializeTopicList(topics: WorkspaceTopic[]) {
  return topics
    .map(
      (topic) =>
        `[${topic.id}] ${topic.label} (${topic.status})${
          topic.description ? ` — ${topic.description}` : ""
        }`
    )
    .join("\n");
}

function serializeTopicRelations(relations: WorkspaceTopicRelation[]) {
  if (relations.length === 0) {
    return "(none)";
  }

  return relations
    .map(
      (relation) =>
        `${relation.fromTopicId} ${relation.relationType} ${relation.toTopicId}`
    )
    .join("\n");
}

async function listActiveIRForTopicIds(projectId: string, topicIds: string[]) {
  if (topicIds.length === 0) {
    return [];
  }

  const { data, error } = await getClient()
    .from("ir_nodes")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "active")
    .in("topic_id", topicIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load IR context nodes", error);
    return [];
  }

  return ((data ?? []) as DatabaseRecord[]).map(mapIRNode);
}

async function listActiveIREdgesForNodeIds(
  projectId: string,
  nodeIds: string[]
) {
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
    console.error("Failed to load IR context edges", error);
    return [];
  }

  const nodeIdSet = new Set(nodeIds);
  return ((data ?? []) as DatabaseRecord[])
    .map(mapIREdge)
    .filter((edge) => nodeIdSet.has(edge.toNode));
}

export async function assembleContext(topicId: string, projectId: string) {
  const [topics, relations] = await Promise.all([
    listTopicsByProjectId(projectId),
    listTopicRelationsByProjectId(projectId).catch(
      (): WorkspaceTopicRelation[] => []
    ),
  ]);
  const topicIds = resolveTopicContextIds({
    activeTopicId: topicId,
    topics,
    relations,
  });
  const nodes = await listActiveIRForTopicIds(projectId, topicIds);
  const edges = await listActiveIREdgesForNodeIds(
    projectId,
    nodes.map((node) => node.id)
  );

  if (nodes.length === 0) {
    return "";
  }

  const relevantTopics = topics.filter((topic) => topicIds.includes(topic.id));
  const header = [
    "<topic_context>",
    serializeTopicList(relevantTopics),
    "</topic_context>",
  ].join("\n");

  const irBlock = serializeIRWithinBudget({
    nodes,
    edges,
    budgetChars: MAX_CONTEXT_CHARS - header.length - 1,
    activeTopicId: topicId,
  });

  return [header, irBlock].filter(Boolean).join("\n");
}

export async function assembleProjectContext(projectId: string) {
  const [topics, relations] = await Promise.all([
    listTopicsByProjectId(projectId),
    listTopicRelationsByProjectId(projectId).catch(
      (): WorkspaceTopicRelation[] => []
    ),
  ]);
  const topicIds = getProjectActiveTopicIds(topics);
  const nodes = await listActiveIRForTopicIds(projectId, topicIds);
  const edges = await listActiveIREdgesForNodeIds(
    projectId,
    nodes.map((node) => node.id)
  );
  const activeTopics = topics.filter((topic) => topicIds.includes(topic.id));
  const activeRelations = (relations as WorkspaceTopicRelation[]).filter(
    (relation: WorkspaceTopicRelation) =>
      topicIds.includes(relation.fromTopicId) ||
      topicIds.includes(relation.toTopicId)
  );

  const header = [
    "<project_context>",
    serializeTopicList(activeTopics) || "(no decided or executing topics)",
    "</project_context>",
    "<topic_relations>",
    serializeTopicRelations(activeRelations),
    "</topic_relations>",
  ].join("\n");

  const irBlock =
    serializeIRWithinBudget({
      nodes,
      edges,
      budgetChars: MAX_CONTEXT_CHARS - header.length - 1,
      activeTopicId: null,
    }) || "(no active IR)";

  return [header, irBlock].join("\n");
}
