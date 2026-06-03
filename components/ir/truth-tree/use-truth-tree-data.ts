/**
 * useTruthTreeData — compiles flat IRNode[] + IREdge[] into a renderable
 * DAG tree per docs/ir-ui-interaction-v1.3.md §4.
 *
 * Pure function: same inputs → same outputs. No fetching, no SWR. The
 * caller (TruthTree component) feeds it data already loaded by useIR().
 */

import { useMemo } from "react";
import type { IREdge, IRNode } from "@/lib/ir/types";
import { RELATION_PRIORITY, TREE_SHAPE_RELATIONS } from "./glyphs";

export type TruthTreeData = {
  /** All nodes indexed by id, for O(1) lookup */
  nodeById: Map<string, IRNode>;
  /** Top-level roots — no incoming primary edge */
  rootIds: string[];
  /** Subset of rootIds where topic_id is null */
  unassignedRootIds: string[];
  /** Subset of rootIds where topic_id is non-null */
  assignedRootIds: string[];
  /**
   * For each parent: child ids where THIS parent is the child's primary parent.
   * These render as full subtrees.
   */
  primaryChildrenOf: Map<string, string[]>;
  /**
   * For each parent: child ids where THIS parent is a non-primary parent.
   * These render as 1-line shadow rows (no recursion).
   */
  shadowChildrenOf: Map<string, string[]>;
  /** child id → primary parent id (null if root) */
  primaryParentOf: Map<string, string | null>;
  /**
   * For each child: total parent count (across all tree-shape relations).
   * Used to compute the `↑N` shadow marker.
   */
  parentCountOf: Map<string, number>;
  /** (parentId, childId) → the IREdge connecting them (for relation glyph rendering) */
  edgeOf: (parentId: string, childId: string) => IREdge | null;
};

type IncomingEdge = {
  edge: IREdge;
  parentId: string;
};

/**
 * Build the tree data structure. Side-effect free.
 *
 * Filters:
 * - Edges: status === 'active' AND relation ∈ TREE_SHAPE_RELATIONS
 *   (supersedes lives in version chain; contradicts is bidirectional, doesn't shape tree)
 * - Nodes: caller is responsible for pre-filtering (e.g. hide superseded by default)
 */
export function buildTruthTreeData(
  nodes: IRNode[],
  edges: IREdge[]
): TruthTreeData {
  const nodeById = new Map<string, IRNode>(nodes.map((n) => [n.id, n]));

  // Active tree-shape edges only
  const treeEdges = edges.filter(
    (e) => e.status === "active" && TREE_SHAPE_RELATIONS.has(e.relation)
  );

  // Index incoming tree-shape edges per child
  const incomingByChild = new Map<string, IncomingEdge[]>();
  for (const edge of treeEdges) {
    if (!nodeById.has(edge.fromNode) || !nodeById.has(edge.toNode)) {
      continue; // dangling edge, skip
    }
    // Edge direction depends on relation semantics:
    //   implies, refines, depends_on: from = source (parent), to = source (parent)?
    //
    // Per docs/prompts/ir-edge-contract.md (and §2.3 of v1.3 spec):
    //   - implies:    from = parent (causes), to = child (is implied)
    //   - depends_on: from = child (depends), to = parent (provides)
    //   - refines:    from = child (refinement), to = parent (general)
    //   - resolves:   from = child (answer),     to = parent (question)
    //
    // So the parent in tree terms is computed per-relation:
    const { parentId, childId } = parentChildOf(edge);
    if (!parentId || !childId) {
      continue;
    }
    let childIncoming = incomingByChild.get(childId);
    if (!childIncoming) {
      childIncoming = [];
      incomingByChild.set(childId, childIncoming);
    }
    childIncoming.push({ edge, parentId });
  }

  // Pick primary parent for each child
  const primaryParentOf = new Map<string, string | null>();
  for (const node of nodes) {
    const incoming = incomingByChild.get(node.id) ?? [];
    if (incoming.length === 0) {
      primaryParentOf.set(node.id, null);
      continue;
    }
    const primary = pickPrimary(incoming, nodeById);
    primaryParentOf.set(node.id, primary.parentId);
  }

  // Build primaryChildrenOf and shadowChildrenOf
  const primaryChildrenOf = new Map<string, string[]>();
  const shadowChildrenOf = new Map<string, string[]>();
  for (const [childId, incoming] of incomingByChild) {
    const primary = primaryParentOf.get(childId);
    for (const { parentId } of incoming) {
      const target =
        parentId === primary ? primaryChildrenOf : shadowChildrenOf;
      let childIds = target.get(parentId);
      if (!childIds) {
        childIds = [];
        target.set(parentId, childIds);
      }
      childIds.push(childId);
    }
  }

  // Sort children deterministically: by node.createdAt asc, then id asc
  const sortChildren = (ids: string[]) =>
    ids.sort((a, b) => {
      const na = nodeById.get(a);
      const nb = nodeById.get(b);
      if (!(na && nb)) {
        return a.localeCompare(b);
      }
      const cmp = na.createdAt.localeCompare(nb.createdAt);
      return cmp === 0 ? a.localeCompare(b) : cmp;
    });
  for (const list of primaryChildrenOf.values()) {
    sortChildren(list);
  }
  for (const list of shadowChildrenOf.values()) {
    sortChildren(list);
  }

  // Roots: nodes with no incoming primary edge
  const rootIds = nodes
    .filter((n) => primaryParentOf.get(n.id) == null)
    .map((n) => n.id);
  sortRoots(rootIds, nodeById);

  const unassignedRootIds = rootIds.filter(
    (id) => nodeById.get(id)?.topicId == null
  );
  const assignedRootIds = rootIds.filter(
    (id) => nodeById.get(id)?.topicId != null
  );

  // Parent count for ↑N shadow marker
  const parentCountOf = new Map<string, number>();
  for (const [childId, incoming] of incomingByChild) {
    parentCountOf.set(childId, incoming.length);
  }

  // Edge lookup
  const edgeIndex = new Map<string, IREdge>();
  for (const edge of treeEdges) {
    const { parentId, childId } = parentChildOf(edge);
    if (parentId && childId) {
      edgeIndex.set(`${parentId}→${childId}`, edge);
    }
  }
  const edgeOf = (parentId: string, childId: string): IREdge | null =>
    edgeIndex.get(`${parentId}→${childId}`) ?? null;

  return {
    nodeById,
    rootIds,
    unassignedRootIds,
    assignedRootIds,
    primaryChildrenOf,
    shadowChildrenOf,
    primaryParentOf,
    parentCountOf,
    edgeOf,
  };
}

/**
 * Given an edge, return (parentId, childId) according to the relation's
 * semantic direction.
 *
 * `from`/`to` in the DB are not always parent/child — `depends_on` flips
 * because "A depends_on B" means B is upstream (parent) of A.
 */
function parentChildOf(edge: IREdge): {
  parentId: string | null;
  childId: string | null;
} {
  const { fromNode: a, toNode: b, relation } = edge;
  switch (relation) {
    case "implies":
      // A implies B → A is parent, B is child
      return { parentId: a, childId: b };
    case "depends_on":
    case "refines":
    case "resolves":
      // A depends_on/refines/resolves B → B is parent, A is child
      return { parentId: b, childId: a };
    default:
      return { parentId: null, childId: null };
  }
}

function pickPrimary(
  incoming: IncomingEdge[],
  nodeById: Map<string, IRNode>
): IncomingEdge {
  // Sort by relation priority, then parent.createdAt asc, then parent id asc
  const sorted = [...incoming].sort((x, y) => {
    const px = RELATION_PRIORITY.get(x.edge.relation) ?? 99;
    const py = RELATION_PRIORITY.get(y.edge.relation) ?? 99;
    if (px !== py) {
      return px - py;
    }
    const nx = nodeById.get(x.parentId);
    const ny = nodeById.get(y.parentId);
    if (nx && ny) {
      const cmp = nx.createdAt.localeCompare(ny.createdAt);
      if (cmp !== 0) {
        return cmp;
      }
    }
    return x.parentId.localeCompare(y.parentId);
  });
  return sorted[0];
}

function sortRoots(rootIds: string[], nodeById: Map<string, IRNode>): void {
  // Roots: kind priority (goal first, then constraint, principle, others), then createdAt asc
  const KIND_ORDER: Record<string, number> = {
    goal: 0,
    constraint: 1,
    principle: 2,
    hypothesis: 3,
    plan: 4,
    open_question: 5,
    rejection: 6,
    unclassified: 7,
  };
  rootIds.sort((a, b) => {
    const na = nodeById.get(a);
    const nb = nodeById.get(b);
    if (!(na && nb)) {
      return a.localeCompare(b);
    }
    const oa = KIND_ORDER[na.kind] ?? 99;
    const ob = KIND_ORDER[nb.kind] ?? 99;
    if (oa !== ob) {
      return oa - ob;
    }
    const cmp = na.createdAt.localeCompare(nb.createdAt);
    return cmp === 0 ? a.localeCompare(b) : cmp;
  });
}

/**
 * React hook wrapper. Memoizes on the input arrays (assumes caller passes
 * stable references — useIR() already does this via SWR).
 */
export function useTruthTreeData(
  nodes: IRNode[],
  edges: IREdge[]
): TruthTreeData {
  return useMemo(() => buildTruthTreeData(nodes, edges), [nodes, edges]);
}

// Re-export relation type for convenience in consumer modules.
export type { IRRelation } from "@/lib/ir/types";
