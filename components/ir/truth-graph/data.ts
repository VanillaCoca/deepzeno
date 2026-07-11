import type { IREdge, IRNode, IRRelation } from "@/lib/ir/types";

export type TruthGraphTopic = {
  id: string | null;
  label: string;
};

export type TruthGraphTopicGroup = {
  topic: TruthGraphTopic;
  nodes: IRNode[];
};

export type TruthGraphFlowEdge = {
  id: string;
  edge: IREdge;
  parentId: string;
  childId: string;
};

export type TruthGraphModel = {
  nodeById: Map<string, IRNode>;
  parentEdgesByChild: Map<string, TruthGraphFlowEdge[]>;
  childEdgesByParent: Map<string, TruthGraphFlowEdge[]>;
  flowEdges: TruthGraphFlowEdge[];
  topicGroups: TruthGraphTopicGroup[];
};

const FLOW_RELATIONS = new Set<IRRelation>([
  "implies",
  "depends_on",
  "refines",
  "resolves",
]);

const TOPICLESS_ID = "__unassigned__";

function parentChildOf(edge: IREdge) {
  switch (edge.relation) {
    case "implies":
      return { parentId: edge.fromNode, childId: edge.toNode };
    case "depends_on":
    case "refines":
    case "resolves":
      return { parentId: edge.toNode, childId: edge.fromNode };
    default:
      return null;
  }
}

function sortNodes(nodes: IRNode[]) {
  return [...nodes].sort((left, right) => {
    const created = left.createdAt.localeCompare(right.createdAt);
    return created === 0 ? left.id.localeCompare(right.id) : created;
  });
}

export function buildTruthGraphModel({
  edges,
  nodes,
  topics,
}: {
  edges: IREdge[];
  nodes: IRNode[];
  topics: TruthGraphTopic[];
}): TruthGraphModel {
  const sortedNodes = sortNodes(nodes);
  const nodeById = new Map(sortedNodes.map((node) => [node.id, node]));
  const flowEdges = edges.flatMap((edge): TruthGraphFlowEdge[] => {
    if (edge.status !== "active" || !FLOW_RELATIONS.has(edge.relation)) {
      return [];
    }

    const endpoints = parentChildOf(edge);

    if (
      !endpoints ||
      !nodeById.has(endpoints.parentId) ||
      !nodeById.has(endpoints.childId)
    ) {
      return [];
    }

    return [{ id: edge.id, edge, ...endpoints }];
  });

  const parentEdgesByChild = new Map<string, TruthGraphFlowEdge[]>();
  const childEdgesByParent = new Map<string, TruthGraphFlowEdge[]>();

  for (const edge of flowEdges) {
    const parentEdges = parentEdgesByChild.get(edge.childId) ?? [];
    parentEdges.push(edge);
    parentEdgesByChild.set(edge.childId, parentEdges);

    const childEdges = childEdgesByParent.get(edge.parentId) ?? [];
    childEdges.push(edge);
    childEdgesByParent.set(edge.parentId, childEdges);
  }

  const topicLabels = new Map(
    topics.map((topic) => [topic.id ?? TOPICLESS_ID, topic.label])
  );
  const topicOrder = new Map(
    topics.map((topic, index) => [topic.id ?? TOPICLESS_ID, index])
  );
  const grouped = new Map<string, IRNode[]>();

  for (const node of sortedNodes) {
    const topicId = node.topicId ?? TOPICLESS_ID;
    const bucket = grouped.get(topicId) ?? [];
    bucket.push(node);
    grouped.set(topicId, bucket);
  }

  const topicGroups = [...grouped.entries()]
    .sort(([left], [right]) => {
      const leftOrder = topicOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = topicOrder.get(right) ?? Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.localeCompare(right);
    })
    .map(([topicId, groupNodes]) => ({
      topic: {
        id: topicId === TOPICLESS_ID ? null : topicId,
        label:
          topicLabels.get(topicId) ??
          (topicId === TOPICLESS_ID ? "Unassigned" : "Unknown topic"),
      },
      nodes: groupNodes,
    }));

  return {
    nodeById,
    parentEdgesByChild,
    childEdgesByParent,
    flowEdges,
    topicGroups,
  };
}

export function getUpstreamNodeIds(
  model: TruthGraphModel,
  selectedNodeId: string | null
) {
  if (!selectedNodeId || !model.nodeById.has(selectedNodeId)) {
    return new Set<string>();
  }

  const upstream = new Set<string>();

  function visit(nodeId: string) {
    if (upstream.has(nodeId)) {
      return;
    }

    upstream.add(nodeId);

    for (const edge of model.parentEdgesByChild.get(nodeId) ?? []) {
      visit(edge.parentId);
    }
  }

  visit(selectedNodeId);
  return upstream;
}

export function getEdgesWithinNodeSet(
  model: TruthGraphModel,
  nodeIds: Set<string>
) {
  return model.flowEdges.filter(
    (edge) => nodeIds.has(edge.parentId) && nodeIds.has(edge.childId)
  );
}

export function getChainRootIds(model: TruthGraphModel, nodeIds: Set<string>) {
  return [...nodeIds].filter((nodeId) =>
    (model.parentEdgesByChild.get(nodeId) ?? []).every(
      (edge) => !nodeIds.has(edge.parentId)
    )
  );
}

// Topological order of the chain (foundational premises first → the selected
// node last), so the chain can render as a top-to-bottom text derivation
// instead of a spatially laid-out block graph. Ties break by createdAt so the
// order is stable across renders; any node left in a cycle is appended.
export function getChainOrder(
  model: TruthGraphModel,
  nodeIds: Set<string>
): string[] {
  const edges = getEdgesWithinNodeSet(model, nodeIds);
  const indegree = new Map<string, number>();
  const childrenByParent = new Map<string, string[]>();

  for (const id of nodeIds) {
    indegree.set(id, 0);
  }
  for (const edge of edges) {
    childrenByParent.set(edge.parentId, [
      ...(childrenByParent.get(edge.parentId) ?? []),
      edge.childId,
    ]);
    indegree.set(edge.childId, (indegree.get(edge.childId) ?? 0) + 1);
  }

  const rank = (id: string) => model.nodeById.get(id)?.createdAt ?? id;
  const nextReady = (visited: Set<string>) =>
    [...nodeIds]
      .filter((id) => !visited.has(id) && (indegree.get(id) ?? 0) === 0)
      .sort((left, right) => rank(left).localeCompare(rank(right)));

  const order: string[] = [];
  const visited = new Set<string>();
  let ready = nextReady(visited);

  while (ready.length > 0) {
    const id = ready[0];
    visited.add(id);
    order.push(id);
    for (const child of childrenByParent.get(id) ?? []) {
      indegree.set(child, (indegree.get(child) ?? 0) - 1);
    }
    ready = nextReady(visited);
  }

  for (const id of [...nodeIds].sort((left, right) =>
    rank(left).localeCompare(rank(right))
  )) {
    if (!visited.has(id)) {
      order.push(id);
    }
  }

  return order;
}
