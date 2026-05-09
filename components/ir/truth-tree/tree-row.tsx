"use client";

/**
 * TreeRow — single-row renderer for Truth Tree v1.3.
 * See docs/ir-ui-interaction-v1.3.md §2.5 (information layering).
 *
 * Three regions, left-to-right:
 *   1. STRUCTURE: indent guides + ────  connector + status dot (mono-color)
 *   2. CONTENT:   title (14px sans, weight 500) — flex-grow, the hero
 *   3. METADATA:  optional inline relation label, short_id, kind pill,
 *                 optional ↑N shadow marker (all 11–12px, muted)
 *
 * Pure presentation — click forwards to onSelect.
 */

import type { IREdge, IRKind, IRNode } from "@/lib/ir/types";
import { cn } from "@/lib/utils";
import {
  getEdgeLabelColorVar,
  getEdgeRendering,
  getKindCode,
  getKindColorVar,
  getStatusGlyph,
  STATUS_OPACITY,
} from "./glyphs";

export type TreeRowProps = {
  node: IRNode;
  /** Depth in the tree (0 = root). */
  depth: number;
  /**
   * For each ancestor level (0..depth-1), whether that ancestor still has
   * more siblings below. Length == depth.
   */
  ancestorHasMoreSiblings: boolean[];
  /** Whether this row is the last sibling under its parent. */
  isLastSibling: boolean;
  /** Edge from parent to this node (null for roots). */
  edgeFromParent: IREdge | null;
  /** Parent's kind, used for edge-rendering specialization. */
  parentKind: IRKind | null;
  /** Total parent count for `↑N` marker (rendered if > 1). */
  totalParentCount: number;
  /** Primary parent's id for shadow rows' "(also under …)" note. */
  primaryParentShortId: string | null;
  /** True iff this row is a shadow rendering (under a non-primary parent). */
  isShadow: boolean;
  /** Currently selected node id from outer state. */
  selectedNodeId: string | null;
  /** Forwarded click handler. */
  onSelect: (nodeId: string) => void;
};

export function TreeRow({
  node,
  depth,
  ancestorHasMoreSiblings,
  isLastSibling,
  edgeFromParent,
  parentKind,
  totalParentCount,
  primaryParentShortId,
  isShadow,
  selectedNodeId,
  onSelect,
}: TreeRowProps) {
  const isSelected = selectedNodeId === node.id;
  const statusGlyph = getStatusGlyph(node.status);
  const kindCode = getKindCode(node.kind, node.subtype);
  const kindColorVar = getKindColorVar(node.kind, node.subtype);
  const baseOpacity = isShadow ? 0.6 : (STATUS_OPACITY[node.status] ?? 1);

  const edgeRendering = edgeFromParent
    ? getEdgeRendering(edgeFromParent.relation, parentKind)
    : { kind: "default" as const };
  const edgeLabel =
    edgeRendering.kind !== "default" ? edgeRendering.label : null;
  const edgeColorVar = getEdgeLabelColorVar(edgeRendering);

  return (
    <button
      aria-selected={isSelected}
      className={cn(
        "group relative flex h-7 w-full items-center gap-0 px-3",
        "border-l-2 border-transparent text-left",
        "hover:bg-[rgba(255,255,255,0.04)]",
        "transition-colors",
        isSelected && "border-l-[var(--ir-text-primary)] bg-[rgba(255,255,255,0.02)]",
        node.status === "superseded" && "line-through"
      )}
      data-testid={`tree-row-${node.id}`}
      onClick={() => onSelect(node.id)}
      style={{ opacity: baseOpacity }}
      type="button"
    >
      {/* === LEFT: structure (indent + connector + status) === */}
      <span className="flex shrink-0 items-center font-mono text-[13px] leading-none text-[var(--ir-text-tertiary)]">
        {ancestorHasMoreSiblings.map((hasMore, i) => (
          <span className="inline-block w-4 text-center" key={`anc-${i}`}>
            {hasMore ? "│" : " "}
          </span>
        ))}
        {depth > 0 && (
          <>
            <span className="inline-block w-4 text-center">
              {isLastSibling ? "└" : "├"}
            </span>
            <span className="text-[var(--ir-text-tertiary)]">────</span>
          </>
        )}
      </span>

      {/* status dot — the only colored glyph in the row */}
      <span
        className="ml-2 mr-3 inline-block w-4 shrink-0 text-center text-[14px] leading-none text-[var(--ir-text-primary)]"
      >
        {statusGlyph}
      </span>

      {/* === CENTER: title (hero) === */}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[14px] font-medium leading-snug text-[var(--ir-text-primary)]",
          isShadow && "italic"
        )}
        title={node.title}
      >
        {node.title}
      </span>

      {/* === RIGHT: metadata (inline label, short_id, kind pill, shadow marker) === */}
      <span className="ml-3 flex shrink-0 items-center gap-2">
        {/* Inline relation label — only on non-default relations */}
        {edgeLabel && (
          <span
            className="font-sans text-[11px] leading-none"
            style={
              edgeColorVar ? { color: `var(${edgeColorVar})` } : undefined
            }
          >
            {edgeLabel}
            {edgeRendering.kind === "resolves" && primaryParentShortId == null && (
              <> {/* could append " Q1" if we threaded the parent id — left for M5 */} </>
            )}
          </span>
        )}

        {/* "(also under X)" for shadow rows */}
        {isShadow && primaryParentShortId && (
          <span className="font-sans text-[11px] leading-none text-[var(--ir-text-tertiary)]">
            also under {primaryParentShortId}
          </span>
        )}

        {/* short_id */}
        <span className="font-mono text-[12px] leading-none text-[var(--ir-text-secondary)]">
          {node.id}
        </span>

        {/* kind pill */}
        <span
          className="rounded-sm px-1.5 py-0.5 font-sans text-[11px] font-medium leading-none"
          style={
            kindColorVar
              ? {
                  color: `var(${kindColorVar})`,
                  backgroundColor: `color-mix(in srgb, var(${kindColorVar}) 14%, transparent)`,
                }
              : { color: "var(--ir-text-tertiary)" }
          }
        >
          {kindCode}
        </span>

        {/* ↑N shadow marker for multi-parent rows (primary occurrence only) */}
        {totalParentCount > 1 && !isShadow && (
          <span className="font-mono text-[11px] leading-none text-[var(--ir-text-tertiary)]">
            ↑{totalParentCount - 1}
          </span>
        )}
      </span>
    </button>
  );
}
