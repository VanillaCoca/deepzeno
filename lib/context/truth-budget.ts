// Pure ranking + budgeting for the truth-memory context block. Kept free of
// server-only imports so it can be unit-tested directly (same split as
// patrol-core.ts / inbox-core.ts).

export const MAX_CONTEXT_CHARS = 18_000;
// Share of the IR budget reserved for edges. Nodes carry the meaning; edges
// carry the shape. Nodes get first claim, edges get what is left.
const EDGE_BUDGET_RATIO = 0.2;

export type ContextIRNode = {
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

export type ContextIREdge = {
  id: string;
  projectId: string;
  fromNode: string;
  toNode: string;
  relation: string;
  status: string;
};

// Ranking weight per IR kind, ordered by the cost of the model NOT seeing it.
//
// Dropping a constraint or a goal makes the model propose something outside
// the problem; dropping a principle or a rejection makes it re-propose what
// the user already ruled out (truth-graph amendment №1: the extraction layer
// must consult the exclusion set before proposing anything). Those failures
// are silent and expensive. A dropped plan is merely re-derivable — plans are
// also the most frequently superseded kind, so they are the cheapest to lose.
const KIND_WEIGHT: Record<string, number> = {
  constraint: 6,
  goal: 6,
  principle: 5,
  rejection: 5,
  open_question: 4,
  hypothesis: 3,
  plan: 2,
};
const DEFAULT_KIND_WEIGHT = 1;

// Relations that make the *target* node a premise others rest on. Mirrors
// dependentCount() in lib/research/watch-suggest.ts: depends_on / refines /
// resolves point child → parent, so load accrues on to_node.
const INBOUND_LOAD_RELATIONS = new Set(["depends_on", "refines", "resolves"]);
// implies points parent → child, so load accrues on from_node.
const OUTBOUND_LOAD_RELATIONS = new Set(["implies"]);
const MAX_COUNTED_LOAD = 8;

// Count, per node, how many other nodes structurally rest on it. A node with
// many dependents is load-bearing: dropping it orphans everything above it.
function computeStructuralLoad(edges: ContextIREdge[]): Map<string, number> {
  const load = new Map<string, number>();
  const bump = (nodeId: string) => {
    load.set(nodeId, (load.get(nodeId) ?? 0) + 1);
  };

  for (const edge of edges) {
    if (INBOUND_LOAD_RELATIONS.has(edge.relation)) {
      bump(edge.toNode);
    } else if (OUTBOUND_LOAD_RELATIONS.has(edge.relation)) {
      bump(edge.fromNode);
    }
  }

  return load;
}

// Higher wins. Kind dominates (×100), topic proximity is the next lever (×20,
// so it can never outrank a kind step), structural load only separates peers.
// Recency is deliberately NOT part of the score: confirmed truth does not get
// weaker by being old. It is used as the tiebreaker only.
function scoreNode({
  node,
  activeTopicId,
  load,
}: {
  node: ContextIRNode;
  activeTopicId: string | null;
  load: number;
}): number {
  const kindWeight = KIND_WEIGHT[node.kind] ?? DEFAULT_KIND_WEIGHT;
  let topicWeight = 0;
  if (node.topicId) {
    topicWeight = activeTopicId && node.topicId === activeTopicId ? 2 : 1;
  }

  return (
    kindWeight * 100 + topicWeight * 20 + Math.min(load, MAX_COUNTED_LOAD)
  );
}

function renderNodeLine(node: ContextIRNode): string {
  const type =
    node.kind === "plan" && node.subtype
      ? `${node.kind}/${node.subtype}`
      : node.kind;
  const topicLabel = node.topicId ? `topic=${node.topicId}` : "unassigned";
  const body = node.content?.trim();
  const rationale = node.rationale?.trim();
  const details = [
    body && body !== node.title ? body : null,
    rationale ? `because ${rationale}` : null,
  ].filter(Boolean);

  return `- [${node.id}] (${type}, ${topicLabel}) ${node.title}${
    details.length > 0 ? ` — ${details.join(" | ")}` : ""
  }`;
}

function renderEdgeLine(edge: ContextIREdge): string {
  return `- ${edge.fromNode} ${edge.relation} ${edge.toNode}`;
}

// Iron Law 2 (宁漏勿错) at the context layer. A blind slice() leaves the model
// unable to tell that anything is missing, so it fills the hole by inventing.
// Naming the omission converts a silent fabrication into an answerable
// question.
function renderOmissionNotice(
  omitted: ContextIRNode[],
  omittedEdgeCount: number
): string {
  if (omitted.length === 0 && omittedEdgeCount === 0) {
    return "";
  }

  const byKind = new Map<string, number>();
  for (const node of omitted) {
    byKind.set(node.kind, (byKind.get(node.kind) ?? 0) + 1);
  }
  const breakdown = [...byKind.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([kind, count]) => `${kind}×${count}`)
    .join(", ");

  const parts = [
    omitted.length > 0
      ? `${omitted.length} active node(s) not loaded (${breakdown})`
      : null,
    omittedEdgeCount > 0 ? `${omittedEdgeCount} edge(s) not loaded` : null,
  ].filter(Boolean);

  return [
    "<ir_omitted>",
    `${parts.join("; ")} — trimmed to fit the context budget, ranked lowest by kind, topic proximity and structural load.`,
    "If an answer would depend on material you cannot see here, say so and ask the user to open the relevant topic. Do NOT assume the omitted items do not exist.",
    "</ir_omitted>",
  ].join("\n");
}

// Select the highest-ranked nodes that fit the character budget, then the
// edges whose endpoints both survived. Selection is by rank; presentation
// order stays kind-grouped so the block reads the same way it always has.
export function serializeIRWithinBudget({
  nodes,
  edges,
  budgetChars,
  activeTopicId,
}: {
  nodes: ContextIRNode[];
  edges: ContextIREdge[];
  budgetChars: number;
  activeTopicId: string | null;
}): string {
  if (nodes.length === 0) {
    return "";
  }

  const load = computeStructuralLoad(edges);
  const ranked = [...nodes].sort((left, right) => {
    const delta =
      scoreNode({
        node: right,
        activeTopicId,
        load: load.get(right.id) ?? 0,
      }) -
      scoreNode({ node: left, activeTopicId, load: load.get(left.id) ?? 0 });
    if (delta !== 0) {
      return delta;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });

  const nodeBudget = Math.max(
    0,
    Math.floor(budgetChars * (1 - EDGE_BUDGET_RATIO))
  );
  const kept: ContextIRNode[] = [];
  const omitted: ContextIRNode[] = [];
  let used = 0;

  for (const node of ranked) {
    const cost = renderNodeLine(node).length + 1;
    // Never cut a node in half: a truncated node reads as a complete one.
    if (used + cost > nodeBudget && kept.length > 0) {
      omitted.push(node);
      continue;
    }

    kept.push(node);
    used += cost;
  }

  const keptIds = new Set(kept.map((node) => node.id));
  const connected = edges.filter(
    (edge) => keptIds.has(edge.fromNode) && keptIds.has(edge.toNode)
  );

  const edgeBudget = Math.max(0, budgetChars - used);
  const keptEdges: ContextIREdge[] = [];
  let edgeUsed = 0;
  let omittedEdgeCount = 0;

  for (const edge of connected) {
    const cost = renderEdgeLine(edge).length + 1;
    if (edgeUsed + cost > edgeBudget) {
      omittedEdgeCount += 1;
      continue;
    }

    keptEdges.push(edge);
    edgeUsed += cost;
  }

  const nodeLines = [...kept]
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind.localeCompare(right.kind);
      }

      return right.createdAt.localeCompare(left.createdAt);
    })
    .map(renderNodeLine);
  const edgeLines = keptEdges.map(renderEdgeLine);

  return [
    "<ir_nodes>",
    ...nodeLines,
    "</ir_nodes>",
    edgeLines.length > 0 ? "<ir_edges>" : "",
    ...edgeLines,
    edgeLines.length > 0 ? "</ir_edges>" : "",
    renderOmissionNotice(omitted, omittedEdgeCount),
  ]
    .filter(Boolean)
    .join("\n");
}
