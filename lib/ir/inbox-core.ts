import type { IREdge, IRNode, IRRelation } from "@/lib/ir/types";

/**
 * Pure ranking core for the Judgment Inbox.
 *
 * No `server-only`, no DB access — every function here is a total function over
 * plain node/edge data, so it can be exercised by `scripts/verify-inbox-core.ts`
 * under `tsx` (the repo has no unit runner). This mirrors the existing
 * research/patrol-core.ts ↔ patrol.ts split.
 *
 * Blast radius answers "if I rule wrongly on this candidate, how much confirmed
 * ground moves?" The dependency graph IS the priority function (PRD K2) — we do
 * not invent a second scoring system.
 *
 * Edge direction (confirmed against lib/ir/queries.ts `createIRNodeForUser` and
 * `createSupersedingIRNodeForUser`): an edge is written from the SUBJECT node to
 * its TARGET — "A depends_on B" ⇒ `{ from: A, to: B }`. So a node's dependents
 * (what breaks if it moves) are the FROM-nodes of edges pointing TO it.
 */

// Relations where the from-node is built on / derived from the to-node, i.e.
// undermining the to-node undermines the from-node. `implies` is intentionally
// excluded in v0.1: its direction is semantically reversed ("A implies B" ⇒ B
// is downstream of A), so folding it into the same reverse traversal would
// corrupt the count. Tracked in the PRD assumption log for a later,
// direction-aware pass.
const DEPENDENCY_RELATIONS = new Set<IRRelation>(["depends_on", "refines"]);

// Relations by which a pending candidate reshapes already-confirmed truth. A
// candidate carrying one of these (outgoing, to an active node) is a Tier-A
// ruling: it moves ground rather than only adding to it.
const RESHAPE_RELATIONS = new Set<IRRelation>([
  "supersedes",
  "resolves",
  "contradicts",
]);

/** Traversal cap for blast radius. Approximation, on purpose (PRD D1 §3). */
export const BLAST_RADIUS_MAX_DEPTH = 3;

/** How many direct downstream nodes the ruling preview names (PRD R1). */
export const INBOX_TOP_DOWNSTREAM = 3;

export const InboxTier = {
  /** Reshapes an existing confirmed truth (supersede / resolve / contradict). */
  reshape: 0,
  /** Purely additive — a new judgment nothing yet depends on. */
  additive: 1,
} as const;

export type InboxDownstream = {
  id: string;
  title: string;
  relation: IRRelation;
};

export type InboxItem = {
  node: IRNode;
  /** InboxTier.reshape (0) sorts before InboxTier.additive (1). */
  tier: number;
  blastRadius: number;
  topDownstream: InboxDownstream[];
  isSupersede: boolean;
  /** The active truth this candidate reshapes, if any (redline / anchor). */
  reshapeTargetId: string | null;
};

type DependentEdge = { from: string; relation: IRRelation };

// targetNodeId -> [confirmed dependents pointing at it]. Only active from-nodes
// count: blast radius is realized impact on confirmed truth, not speculation.
function buildDependentsIndex(
  edges: IREdge[],
  activeNodeIds: Set<string>
): Map<string, DependentEdge[]> {
  const index = new Map<string, DependentEdge[]>();

  for (const edge of edges) {
    if (edge.status === "dismissed") {
      continue;
    }
    if (!DEPENDENCY_RELATIONS.has(edge.relation)) {
      continue;
    }
    if (!activeNodeIds.has(edge.fromNode)) {
      continue;
    }

    const list = index.get(edge.toNode) ?? [];
    list.push({ from: edge.fromNode, relation: edge.relation });
    index.set(edge.toNode, list);
  }

  return index;
}

// A candidate's proposed reshape edges are read regardless of edge status (they
// are not confirmed yet); we only require the target to be active truth.
function findReshapeTarget(
  nodeId: string,
  outgoingByNode: Map<string, IREdge[]>,
  activeNodeIds: Set<string>
): { targetId: string | null; isSupersede: boolean } {
  const outgoing = outgoingByNode.get(nodeId) ?? [];
  let fallback: { targetId: string; isSupersede: boolean } | null = null;

  for (const edge of outgoing) {
    if (!RESHAPE_RELATIONS.has(edge.relation)) {
      continue;
    }
    if (!activeNodeIds.has(edge.toNode)) {
      continue;
    }
    if (edge.relation === "supersedes") {
      return { targetId: edge.toNode, isSupersede: true };
    }
    fallback ??= { targetId: edge.toNode, isSupersede: false };
  }

  return fallback ?? { targetId: null, isSupersede: false };
}

function computeBlast(
  anchorId: string,
  excludeId: string,
  dependentsIndex: Map<string, DependentEdge[]>,
  nodesById: Map<string, IRNode>
): { radius: number; topDownstream: InboxDownstream[] } {
  const visited = new Set<string>([anchorId, excludeId]);
  const topDownstream: InboxDownstream[] = [];
  let frontier: string[] = [anchorId];

  for (let depth = 0; depth < BLAST_RADIUS_MAX_DEPTH; depth++) {
    const next: string[] = [];

    for (const targetId of frontier) {
      for (const dep of dependentsIndex.get(targetId) ?? []) {
        if (visited.has(dep.from)) {
          continue;
        }
        visited.add(dep.from);
        next.push(dep.from);

        if (depth === 0 && topDownstream.length < INBOX_TOP_DOWNSTREAM) {
          const node = nodesById.get(dep.from);
          topDownstream.push({
            id: dep.from,
            title: node?.title ?? dep.from,
            relation: dep.relation,
          });
        }
      }
    }

    if (next.length === 0) {
      break;
    }
    frontier = next;
  }

  // Seeds (anchor + excluded candidate) never count toward radius.
  const seedCount = anchorId === excludeId ? 1 : 2;
  return { radius: visited.size - seedCount, topDownstream };
}

/**
 * Rank pending candidates into the inbox queue. Tier first (reshaping confirmed
 * truth outranks purely additive candidates), then blast radius desc, then age
 * asc so nothing rots at the bottom (PRD D1 §3).
 *
 * `pendingNodes` must already be status='pending' only — idea nodes never enter
 * the queue (PRD D0-NG4); the query layer enforces that filter.
 */
export function buildInboxItems({
  pendingNodes,
  activeNodes,
  edges,
}: {
  pendingNodes: IRNode[];
  activeNodes: IRNode[];
  edges: IREdge[];
}): InboxItem[] {
  const activeNodeIds = new Set(activeNodes.map((node) => node.id));
  const nodesById = new Map<string, IRNode>();
  for (const node of [...activeNodes, ...pendingNodes]) {
    nodesById.set(node.id, node);
  }

  const dependentsIndex = buildDependentsIndex(edges, activeNodeIds);
  const outgoingByNode = new Map<string, IREdge[]>();
  for (const edge of edges) {
    const list = outgoingByNode.get(edge.fromNode) ?? [];
    list.push(edge);
    outgoingByNode.set(edge.fromNode, list);
  }

  const items = pendingNodes.map((node) => {
    const { targetId, isSupersede } = findReshapeTarget(
      node.id,
      outgoingByNode,
      activeNodeIds
    );
    const anchorId = targetId ?? node.id;
    const { radius, topDownstream } = computeBlast(
      anchorId,
      node.id,
      dependentsIndex,
      nodesById
    );

    return {
      node,
      tier: targetId ? InboxTier.reshape : InboxTier.additive,
      blastRadius: radius,
      topDownstream,
      isSupersede,
      reshapeTargetId: targetId,
    } satisfies InboxItem;
  });

  return sortInboxItems(items);
}

export function sortInboxItems(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    if (a.tier !== b.tier) {
      return a.tier - b.tier;
    }
    if (a.blastRadius !== b.blastRadius) {
      return b.blastRadius - a.blastRadius;
    }
    return a.node.createdAt.localeCompare(b.node.createdAt);
  });
}
