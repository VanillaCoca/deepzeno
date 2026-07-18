"use client";

import { MessageSquarePlusIcon, Share2Icon } from "lucide-react";
import { type CSSProperties, type ReactNode, useMemo } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import type { IRNode } from "@/lib/ir/types";
import { getIRTypeLabel, truncateIRTitle } from "@/lib/ir/types";
import { cn } from "@/lib/utils";
import {
  buildTruthGraphModel,
  getChainRootIds,
  getUpstreamNodeIds,
  relationKey,
  type TruthGraphFlowEdge,
  type TruthGraphModel,
  type TruthGraphTopic,
} from "./data";
import { SemanticLanes } from "./semantic-lanes";

export type TruthGraphMode = "truth" | "all";

export type TruthGraphProps = {
  childrenByParent: Map<string, IRNode[]>;
  // Floating Detail+Action card, rendered by the stage and positioned by the
  // graph as an inset card over the overview canvas (only when a node is
  // selected). Keeping the slot here lets the graph own both floating cards'
  // geometry so they stay aligned.
  detailSlot?: ReactNode;
  edges: TruthGraphFlowEdge["edge"][];
  // Extra header controls (e.g. the research-agent settings popover),
  // rendered at the right end of the graph toolbar.
  headerSlot?: ReactNode;
  mode: TruthGraphMode;
  nodes: IRNode[];
  onModeChange: (mode: TruthGraphMode) => void;
  onSelect: (nodeId: string | null) => void;
  // Lets the empty state send the user to the conversation to start building.
  onStartConversation?: () => void;
  selectedNodeId: string | null;
  topics: TruthGraphTopic[];
  // Nodes under Watchtower patrol — rows get a subtle radar badge.
  watchedNodeIds?: Set<string>;
};

const GRAPH_MIN_NODE_COUNT = 3;

// Text color + decoration for a node, reused across the chain rows so a node
// reads the same whether it's a settled truth (green), an open question
// (amber), a candidate (purple), or a rejected/superseded node (red, struck
// through). Color-blind redundancy is carried by the row prefix glyph and the
// strike-through, never by color alone (rules §4.7).
function nodeTextTone(node: IRNode): {
  color: string;
  decoration: "line-through" | "none";
} {
  if (node.status === "superseded" || node.kind === "rejection") {
    return { color: "var(--z-rejected)", decoration: "line-through" };
  }
  if (node.kind === "open_question") {
    return { color: "var(--z-attention-text)", decoration: "none" };
  }
  if (node.status === "idea") {
    return { color: "var(--z-text-3)", decoration: "none" };
  }
  if (node.status === "pending") {
    return { color: "var(--z-candidate-text)", decoration: "none" };
  }
  return { color: "var(--z-confirmed)", decoration: "none" };
}

// Leading glyph mirrors the overview cues: ▷ foundational premise (chain leaf),
// ✓ the selected node, ◇/○ candidate/idea, • an intermediate step.
function chainPrefix(node: IRNode, isRoot: boolean, isSelected: boolean) {
  if (isSelected) {
    return "✓";
  }
  if (isRoot) {
    return "▷";
  }
  if (node.status === "pending") {
    return "◇";
  }
  if (node.status === "idea") {
    return "○";
  }
  return "•";
}

type ChainTreeNode = {
  id: string;
  // The graph edge linking this node to its tree-parent (this node is the
  // graph-PARENT / premise; the tree-parent is the graph-CHILD it supports).
  edge: TruthGraphFlowEdge | null;
  children: ChainTreeNode[];
};

type ChainRowData = {
  id: string;
  edge: TruthGraphFlowEdge | null;
  // Pre-rendered ASCII guide (│ ├── └──) that draws the branch structure.
  guide: string;
};

// Build the upstream derivation as a real tree rooted at the selected node:
// each tree child is a graph-parent (a premise the node needs), so a node with
// several premises actually branches instead of flattening into one line. A
// shared ancestor renders once (first traversal wins) to keep the tree finite
// and readable.
function buildChainTree(
  model: TruthGraphModel,
  chainNodeIds: Set<string>,
  rootId: string
): ChainTreeNode {
  const visited = new Set<string>();
  const rank = (id: string) => model.nodeById.get(id)?.createdAt ?? id;

  function build(id: string, edge: TruthGraphFlowEdge | null): ChainTreeNode {
    visited.add(id);
    const parentEdges = (model.parentEdgesByChild.get(id) ?? [])
      .filter((e) => chainNodeIds.has(e.parentId) && !visited.has(e.parentId))
      .sort((left, right) =>
        rank(left.parentId).localeCompare(rank(right.parentId))
      );
    return {
      id,
      edge,
      children: parentEdges.map((e) => build(e.parentId, e)),
    };
  }

  return build(rootId, null);
}

// Flatten the tree into ordered rows, each carrying an ASCII guide prefix so
// the branch structure reads like a hand-drawn outline / mind-map.
function flattenChainTree(
  node: ChainTreeNode,
  pipes: boolean[],
  isLast: boolean,
  out: ChainRowData[]
) {
  const guide =
    pipes.map((last) => (last ? "    " : "│   ")).join("") +
    (pipes.length === 0 ? "" : isLast ? "└── " : "├── ");
  out.push({ edge: node.edge, guide, id: node.id });
  node.children.forEach((child, index) => {
    flattenChainTree(
      child,
      [...pipes, isLast],
      index === node.children.length - 1,
      out
    );
  });
}

function CompactTruthList({
  nodes,
  onSelect,
  selectedNodeId,
}: {
  nodes: IRNode[];
  onSelect: (nodeId: string) => void;
  selectedNodeId: string | null;
}) {
  return (
    <div
      className="select-none border-y border-[var(--z-topic-border)]"
      data-testid="truth-graph-compact-list"
      style={{ color: "var(--z-text)", fontFamily: "var(--z-font-sans)" }}
    >
      {nodes.map((node) => {
        const isSelected = selectedNodeId === node.id;

        return (
          <button
            className={cn(
              "flex w-full items-center gap-3 border-b border-[var(--z-topic-border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--z-node-fill)]",
              isSelected && "bg-[var(--z-node-fill)]"
            )}
            key={node.id}
            onClick={() => onSelect(node.id)}
            title={node.title}
            type="button"
          >
            <span
              className={cn(
                "shrink-0 text-[var(--z-text-3)]",
                isSelected && "text-[var(--z-confirmed)]"
              )}
            >
              {isSelected ? "✓" : "•"}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--z-text)]">
              {truncateIRTitle(node.title, 60)}
            </span>
            <span className="shrink-0 text-[11px] text-[var(--z-text-3)]">
              {getIRTypeLabel(node.kind, node.subtype)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TruthGraph({
  childrenByParent,
  detailSlot,
  edges,
  headerSlot,
  mode,
  nodes,
  onModeChange,
  onSelect,
  onStartConversation,
  selectedNodeId,
  topics,
  watchedNodeIds,
}: TruthGraphProps) {
  const { t } = useLocale();
  const model = useMemo(
    () => buildTruthGraphModel({ edges, nodes, topics }),
    [edges, nodes, topics]
  );
  const activeSelectedNodeId =
    selectedNodeId && model.nodeById.has(selectedNodeId)
      ? selectedNodeId
      : null;

  const chainNodeIds = useMemo(() => {
    const upstream = getUpstreamNodeIds(model, activeSelectedNodeId);
    if (!activeSelectedNodeId) {
      return upstream;
    }
    const subNodes = childrenByParent.get(activeSelectedNodeId) ?? [];
    if (subNodes.length === 0) {
      return upstream;
    }
    // Include the selected node's sub-nodes and their 1-hop relations, so the
    // Chain shows how the sub-nodes connect to the rest of the graph.
    const set = new Set(upstream);
    const subIds = new Set(subNodes.map((sub) => sub.id));
    for (const id of subIds) {
      set.add(id);
    }
    for (const edge of edges) {
      if (subIds.has(edge.fromNode) && model.nodeById.has(edge.toNode)) {
        set.add(edge.toNode);
      }
      if (subIds.has(edge.toNode) && model.nodeById.has(edge.fromNode)) {
        set.add(edge.fromNode);
      }
    }
    return set;
  }, [activeSelectedNodeId, model, childrenByParent, edges]);

  const chainRootIds = useMemo(
    () => new Set(getChainRootIds(model, chainNodeIds)),
    [chainNodeIds, model]
  );
  // The chain is the upstream derivation tree of the selected node. Rows are the
  // flattened tree; the row order + guide prefixes carry the branch structure.
  const chainRows = useMemo(() => {
    if (!activeSelectedNodeId) {
      return [] as ChainRowData[];
    }
    const tree = buildChainTree(model, chainNodeIds, activeSelectedNodeId);
    const rows: ChainRowData[] = [];
    flattenChainTree(tree, [], true, rows);
    return rows;
  }, [activeSelectedNodeId, model, chainNodeIds]);
  // Show the chain only when the selected node actually has upstream relations
  // (more than just itself) — an unconnected node has no derivation to draw.
  const showChain = chainRows.length > 1;

  if (nodes.length === 0) {
    // Empty state — new users land here first, so explain what this canvas is
    // for and give a clear next step (industry-standard empty-state pattern:
    // icon → title → one-line explanation → primary action).
    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[var(--z-node-fill)] text-[var(--z-text-3)]">
          <Share2Icon className="size-6" />
        </div>
        <h2 className="font-semibold text-[15px] text-[var(--z-text)]">
          {t("truth.emptyTitle")}
        </h2>
        <p className="mt-2 max-w-xs text-sm leading-[1.6] text-[var(--z-text-3)]">
          {t("truth.emptyBody")}
        </p>
        {onStartConversation ? (
          <Button
            className="mt-5"
            onClick={onStartConversation}
            size="sm"
            variant="secondary"
          >
            <MessageSquarePlusIcon className="size-4" />
            {t("truth.emptyCta")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (nodes.length < GRAPH_MIN_NODE_COUNT) {
    return (
      <CompactTruthList
        nodes={nodes}
        onSelect={onSelect}
        selectedNodeId={selectedNodeId}
      />
    );
  }

  return (
    // The overview is the base canvas. The Chain and Detail panels float ABOVE
    // it as inset rounded cards (only when a node is selected), so the canvas
    // stays free for browsing every IR when nothing is selected.
    // Detail is the tall right column (portrait → readable text); Chain is the
    // wide bottom strip (landscape → fits a horizontal reasoning flow).
    // `--z-detail-w` / `--z-chain-h` size them and let the Chain stop just
    // before the Detail card.
    <div
      className="relative h-full min-h-[360px] border-y border-[var(--z-topic-border)]"
      data-testid="truth-graph"
      style={
        {
          color: "var(--z-text)",
          fontFamily: "var(--z-font-sans)",
          "--z-detail-w": "clamp(320px, 28%, 420px)",
          "--z-chain-h": "clamp(190px, 32%, 300px)",
        } as CSSProperties
      }
    >
      <div className="sr-only" data-testid="truth-graph-text-index">
        {nodes.map((node) => (
          <span key={node.id}>{node.title}</span>
        ))}
      </div>
      <section
        className="flex h-full flex-col bg-[var(--z-bg)]"
        data-testid="truth-graph-overview"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          {/* Primary view filter — enlarged, left-aligned, "All" first (the
              default) so first-time users notice it. Kept compact so it stays
              minimal and never crowds the canvas. */}
          <div className="flex items-center rounded-lg border border-[var(--z-topic-border)] bg-[var(--z-card-bg)] p-0.5">
            {(["all", "truth"] as const).map((scope) => (
              <button
                aria-label={
                  scope === "truth"
                    ? t("graph.showTruthsOnly")
                    : t("graph.showAllStages")
                }
                aria-pressed={mode === scope}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  mode === scope
                    ? "bg-[var(--z-node-fill)] text-[var(--z-text)]"
                    : "text-[var(--z-text-3)] hover:text-[var(--z-text-2)]"
                )}
                key={scope}
                onClick={() => onModeChange(scope)}
                type="button"
              >
                {scope === "truth" ? t("graph.truth") : t("graph.all")}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[var(--z-text-3)]">
              {nodes.length}{" "}
              {mode === "all" ? t("graph.nodes") : t("graph.truths")}
            </span>
            {headerSlot}
          </div>
        </div>
        {/* Semantic-lanes overview (amendment №1): position carries structure,
            density follows lifecycle, and cards self-label — so the legend and
            the pan/zoom chrome are gone. When a node is selected the floating
            Chain/Detail cards overlay bottom/right; padding keeps lanes
            reachable underneath. */}
        <div
          className="relative min-h-0 flex-1 overflow-y-auto"
          style={{
            paddingBottom: showChain
              ? "calc(var(--z-chain-h) + var(--z-card-inset) * 2)"
              : undefined,
            paddingRight: activeSelectedNodeId
              ? "calc(var(--z-detail-w) + var(--z-card-inset) * 2)"
              : undefined,
          }}
        >
          <SemanticLanes
            chainNodeIds={chainNodeIds}
            childrenByParent={childrenByParent}
            model={model}
            onBackgroundClick={() => onSelect(null)}
            onSelect={onSelect}
            selectedNodeId={activeSelectedNodeId}
            watchedNodeIds={watchedNodeIds}
          />
        </div>
      </section>

      {showChain ? (
        // Chain = the wide bottom card. It holds the upstream derivation as a
        // text mind-map: the selected node ✓ at the top, its premises branching
        // below via ├──/└── guides, each branch labeled with the actual
        // relationship (the edge's free-form label, or its relation type).
        <aside
          className="absolute bottom-[var(--z-card-inset)] left-[var(--z-card-inset)] z-10 flex max-h-[var(--z-chain-h)] flex-col overflow-hidden rounded-[var(--z-card-radius)] border border-[var(--z-topic-border)] bg-[var(--z-card-bg)] shadow-[var(--z-card-shadow)]"
          data-testid="truth-graph-chain"
          style={{
            right:
              "calc(var(--z-detail-w) + var(--z-card-inset) + var(--z-card-inset))",
          }}
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--z-text-3)]">
            <span>{t("graph.chain")}</span>
            <span className="normal-case">
              {chainRows.length} {t("graph.steps")}
            </span>
          </div>
          <ul
            aria-label={t("graph.chainAria")}
            className="min-h-0 flex-1 list-none overflow-y-auto px-2 pb-2"
          >
            {chainRows.map((row) => {
              const node = model.nodeById.get(row.id);

              if (!node) {
                return null;
              }

              const isSelected = activeSelectedNodeId === row.id;
              const tone = nodeTextTone(node);
              const glyph = chainPrefix(
                node,
                chainRootIds.has(row.id),
                isSelected
              );
              const suffix = node.kind === "open_question" ? " ?" : "";

              let label: string | null = null;
              if (row.edge) {
                const custom = row.edge.edge.label?.trim();
                if (custom) {
                  label = custom;
                } else {
                  const key = relationKey(row.edge.edge.relation);
                  if (key) {
                    label = t(key);
                  }
                }
              }

              return (
                <li key={row.id}>
                  <button
                    className={cn(
                      "flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left hover:bg-[var(--z-node-fill)]",
                      isSelected && "bg-[var(--z-node-fill)]"
                    )}
                    data-testid={`truth-graph-chain-node-${row.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(row.id);
                    }}
                    title={node.title}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="shrink-0 select-none whitespace-pre font-mono text-[var(--z-text-3)]"
                    >
                      {row.guide}
                    </span>
                    {label ? (
                      <span className="shrink-0 text-[11px] text-[var(--z-edge-label)]">
                        {label} ·
                      </span>
                    ) : null}
                    <span
                      aria-hidden="true"
                      className="shrink-0 select-none"
                      style={{ color: tone.color }}
                    >
                      {glyph}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-sm"
                      style={{
                        color: tone.color,
                        fontWeight: isSelected ? 600 : 500,
                        textDecoration: tone.decoration,
                      }}
                    >
                      {node.title}
                      {suffix}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      ) : null}

      {activeSelectedNodeId && detailSlot ? (
        // Detail = the tall right card (portrait → comfortable reading measure).
        // Spans the full canvas height on the right side.
        <div
          className="absolute top-[var(--z-card-inset)] right-[var(--z-card-inset)] bottom-[var(--z-card-inset)] z-10 flex w-[var(--z-detail-w)] flex-col overflow-hidden rounded-[var(--z-card-radius)] border border-[var(--z-topic-border)] bg-[var(--z-card-bg)] shadow-[var(--z-card-shadow)]"
          data-testid="truth-graph-detail-card"
        >
          {detailSlot}
        </div>
      ) : null}
    </div>
  );
}
