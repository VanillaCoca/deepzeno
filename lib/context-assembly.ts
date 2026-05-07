import "server-only";

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

const MAX_CONTEXT_CHARS = 18_000;

type DatabaseRecord = Record<string, unknown>;

type ContextIRNode = {
  id: string;
  projectId: string;
  topicId: string | null;
  kind: string;
  subtype: string | null;
  title: string;
  content: string | null;
  rationale: string | null;
  createdAt: string;
};

type ContextIREdge = {
  id: string;
  projectId: string;
  fromNode: string;
  toNode: string;
  relation: string;
  status: string;
};

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

function serializeIR({
  nodes,
  edges,
}: {
  nodes: ContextIRNode[];
  edges: ContextIREdge[];
}) {
  if (nodes.length === 0) {
    return "";
  }

  const topicLabel = (node: ContextIRNode) =>
    node.topicId ? `topic=${node.topicId}` : "unassigned";
  const nodeLines = [...nodes]
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind.localeCompare(right.kind);
      }

      return right.createdAt.localeCompare(left.createdAt);
    })
    .map((node) => {
      const type =
        node.kind === "plan" && node.subtype
          ? `${node.kind}/${node.subtype}`
          : node.kind;
      const body = node.content?.trim();
      const rationale = node.rationale?.trim();
      const details = [
        body && body !== node.title ? body : null,
        rationale ? `because ${rationale}` : null,
      ].filter(Boolean);

      return `- [${node.id}] (${type}, ${topicLabel(node)}) ${node.title}${
        details.length > 0 ? ` — ${details.join(" | ")}` : ""
      }`;
    });
  const edgeLines = edges.map(
    (edge) => `- ${edge.fromNode} ${edge.relation} ${edge.toNode}`
  );

  return [
    "<ir_nodes>",
    ...nodeLines,
    "</ir_nodes>",
    edgeLines.length > 0 ? "<ir_edges>" : "",
    ...edgeLines,
    edgeLines.length > 0 ? "</ir_edges>" : "",
  ]
    .filter(Boolean)
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

function clampContext(context: string) {
  return context.length <= MAX_CONTEXT_CHARS
    ? context
    : context.slice(0, MAX_CONTEXT_CHARS);
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
  return clampContext(
    [
      "<topic_context>",
      serializeTopicList(relevantTopics),
      "</topic_context>",
      serializeIR({ nodes, edges }),
    ].join("\n")
  );
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

  return clampContext(
    [
      "<project_context>",
      serializeTopicList(activeTopics) || "(no decided or executing topics)",
      "</project_context>",
      "<topic_relations>",
      serializeTopicRelations(activeRelations),
      "</topic_relations>",
      serializeIR({ nodes, edges }) || "(no active IR)",
    ].join("\n")
  );
}
