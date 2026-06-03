"use client";

/**
 * TruthTree — top-level renderer for the v1.3 By-Relation tree.
 * See docs/ir-ui-interaction-v1.3.md.
 *
 * Reads pre-flattened DAG data from useTruthTreeData and emits a flat
 * sequence of TreeRow components. DFS order with cycle detection.
 *
 * M2 scope: static read-only rendering. No expand/collapse, no
 * keyboard nav, no glyph-click filters. Click forwards to onSelect.
 */

import type { IREdge, IRKind, IRNode } from "@/lib/ir/types";
import { TreeRow } from "./tree-row";
import { type TruthTreeData, useTruthTreeData } from "./use-truth-tree-data";

export type TruthTreeProps = {
  nodes: IRNode[];
  edges: IREdge[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  /** When true, hide the synthetic "Unassigned" header even if empty. */
  hideEmptyUnassigned?: boolean;
};

type RowRecord = {
  key: string;
  node: IRNode;
  depth: number;
  ancestorHasMoreSiblings: boolean[];
  isLastSibling: boolean;
  edgeFromParent: IREdge | null;
  parentKind: IRKind | null;
  totalParentCount: number;
  primaryParentShortId: string | null;
  isShadow: boolean;
};

export function TruthTree({
  nodes,
  edges,
  selectedNodeId,
  onSelect,
  hideEmptyUnassigned = false,
}: TruthTreeProps) {
  const data = useTruthTreeData(nodes, edges);
  const rows = flattenTree(data);

  const unassignedCount = data.unassignedRootIds.length;
  const showUnassignedHeader = unassignedCount > 0 || !hideEmptyUnassigned;

  if (rows.length === 0 && unassignedCount === 0) {
    return (
      <p className="px-3 py-4 text-xs text-[var(--ir-text-tertiary)]">
        No truth nodes yet.
      </p>
    );
  }

  // Split rendered rows by whether their root is unassigned vs assigned
  const unassignedRows: RowRecord[] = [];
  const assignedRows: RowRecord[] = [];
  for (const row of rows) {
    if (isUnderUnassignedRoot(row.node, data)) {
      unassignedRows.push(row);
    } else {
      assignedRows.push(row);
    }
  }

  return (
    <div className="flex flex-col" data-testid="truth-tree">
      {/* Unassigned synthetic root */}
      {showUnassignedHeader && unassignedCount > 0 && (
        <div className="border-b border-[var(--ir-border-default)] px-3 py-2">
          <span className="font-mono text-[11px] text-[var(--ir-text-tertiary)]">
            ▾ Unassigned ({unassignedCount})
          </span>
        </div>
      )}
      {unassignedRows.map((r) => (
        <TreeRow
          ancestorHasMoreSiblings={r.ancestorHasMoreSiblings}
          depth={r.depth}
          edgeFromParent={r.edgeFromParent}
          isLastSibling={r.isLastSibling}
          isShadow={r.isShadow}
          key={r.key}
          node={r.node}
          onSelect={onSelect}
          parentKind={r.parentKind}
          primaryParentShortId={r.primaryParentShortId}
          selectedNodeId={selectedNodeId}
          totalParentCount={r.totalParentCount}
        />
      ))}

      {/* Spacer between unassigned and assigned sections */}
      {unassignedRows.length > 0 && assignedRows.length > 0 && (
        <div className="h-2" />
      )}

      {/* Assigned roots */}
      {assignedRows.map((r) => (
        <TreeRow
          ancestorHasMoreSiblings={r.ancestorHasMoreSiblings}
          depth={r.depth}
          edgeFromParent={r.edgeFromParent}
          isLastSibling={r.isLastSibling}
          isShadow={r.isShadow}
          key={r.key}
          node={r.node}
          onSelect={onSelect}
          parentKind={r.parentKind}
          primaryParentShortId={r.primaryParentShortId}
          selectedNodeId={selectedNodeId}
          totalParentCount={r.totalParentCount}
        />
      ))}
    </div>
  );
}

/**
 * DFS over the DAG, emitting a flat sequence of RowRecords.
 *
 * - Each non-shadow row appears exactly once (under its primary parent).
 * - Shadow rows appear under each non-primary parent, with isShadow=true
 *   and depth = parent.depth + 1; shadow rows do NOT recurse.
 * - Cycles are broken by `visited` tracking — if a primary chain ever
 *   revisits a node (shouldn't happen with current data shape, but safe),
 *   the second occurrence renders as a shadow with an extra annotation.
 */
function flattenTree(data: TruthTreeData): RowRecord[] {
  const result: RowRecord[] = [];
  const visited = new Set<string>();

  const visit = (
    nodeId: string,
    depth: number,
    ancestorFlags: boolean[],
    isLastSibling: boolean,
    parentId: string | null
  ) => {
    const node = data.nodeById.get(nodeId);
    if (!node) {
      return;
    }

    const edge = parentId ? data.edgeOf(parentId, nodeId) : null;
    const parentKind: IRKind | null = parentId
      ? (data.nodeById.get(parentId)?.kind ?? null)
      : null;
    const totalParentCount = data.parentCountOf.get(nodeId) ?? 0;

    const alreadyVisited = visited.has(nodeId);
    const primaryParent = data.primaryParentOf.get(nodeId) ?? null;
    const primaryParentShortId =
      primaryParent && primaryParent !== parentId ? primaryParent : null;
    const isShadow =
      alreadyVisited || (parentId !== null && parentId !== primaryParent);

    result.push({
      key: `${parentId ?? "root"}→${nodeId}`,
      node,
      depth,
      ancestorHasMoreSiblings: ancestorFlags,
      isLastSibling,
      edgeFromParent: edge,
      parentKind,
      totalParentCount,
      primaryParentShortId,
      isShadow,
    });

    if (isShadow) {
      return;
    }
    visited.add(nodeId);

    // Recurse into primary children
    const primaryChildren = data.primaryChildrenOf.get(nodeId) ?? [];
    const shadowChildren = data.shadowChildrenOf.get(nodeId) ?? [];
    const allChildren = [...primaryChildren, ...shadowChildren];

    allChildren.forEach((childId, i) => {
      const isLast = i === allChildren.length - 1;
      const newAncestorFlags = [...ancestorFlags, !isLastSibling];
      visit(childId, depth + 1, newAncestorFlags, isLast, nodeId);
    });
  };

  // Visit assigned roots
  data.assignedRootIds.forEach((rootId, i) => {
    const isLast = i === data.assignedRootIds.length - 1;
    visit(rootId, 0, [], isLast, null);
  });

  // Visit unassigned roots
  // (we intentionally visit them separately so the caller can split the
  // output by inspecting the node.topicId of each emitted row's primary root)
  data.unassignedRootIds.forEach((rootId, i) => {
    const isLast = i === data.unassignedRootIds.length - 1;
    visit(rootId, 0, [], isLast, null);
  });

  return result;
}

/**
 * Is this row's eventual primary root an unassigned (topic_id null) root?
 * We walk up the primary parent chain.
 */
function isUnderUnassignedRoot(node: IRNode, data: TruthTreeData): boolean {
  let current: IRNode | undefined = node;
  while (current) {
    const primaryParentId = data.primaryParentOf.get(current.id);
    if (!primaryParentId) {
      // current is a root
      return current.topicId == null;
    }
    current = data.nodeById.get(primaryParentId);
  }
  return false;
}
