"use client";

import { MessageSquarePlusIcon, Share2Icon } from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useMemo,
} from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import type { IRNode } from "@/lib/ir/types";
import { getIRTypeLabel, truncateIRTitle } from "@/lib/ir/types";
import { cn } from "@/lib/utils";
import {
  buildTruthGraphModel,
  getChainOrder,
  getChainRootIds,
  getEdgesWithinNodeSet,
  getUpstreamNodeIds,
  type TruthGraphFlowEdge,
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
  mode: TruthGraphMode;
  nodes: IRNode[];
  onModeChange: (mode: TruthGraphMode) => void;
  onSelect: (nodeId: string | null) => void;
  // Lets the empty state send the user to the conversation to start building.
  onStartConversation?: () => void;
  selectedNodeId: string | null;
  topics: TruthGraphTopic[];
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

// Leading glyph mirrors the overview cues: ▷ foundational premise (chain root),
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

// One clickable line of the reasoning chain. Replaces the old SVG "tofu block":
// a node is now a text row (still selectable → opens the detail card), so
// several related nodes sit close together and read like a written derivation.
function ChainRow({
  isRoot,
  isSelected,
  node,
  onSelect,
}: {
  isRoot: boolean;
  isSelected: boolean;
  node: IRNode;
  onSelect: (nodeId: string) => void;
}) {
  const tone = nodeTextTone(node);
  const prefix = chainPrefix(node, isRoot, isSelected);
  const suffix = node.kind === "open_question" ? " ?" : "";

  // Stop propagation so selecting a chain row never bubbles to the canvas-wide
  // deselect handler.
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onSelect(node.id);
  }

  return (
    <button
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--z-node-fill)]",
        isSelected && "bg-[var(--z-node-fill)]"
      )}
      data-testid={`truth-graph-chain-node-${node.id}`}
      onClick={handleClick}
      title={node.title}
      type="button"
    >
      <span
        aria-hidden="true"
        className="shrink-0 select-none text-sm leading-relaxed"
        style={{ color: tone.color }}
      >
        {prefix}
      </span>
      <span
        className="min-w-0 flex-1 text-sm leading-relaxed"
        style={{
          color: tone.color,
          textDecoration: tone.decoration,
          fontWeight: isSelected ? 600 : 500,
        }}
      >
        {node.title}
        {suffix}
      </span>
    </button>
  );
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
  mode,
  nodes,
  onModeChange,
  onSelect,
  onStartConversation,
  selectedNodeId,
  topics,
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
  // Relations that actually link the chain together. When there are none, the
  // selected node stands alone — so there is no chain to show (amendment: don't
  // render a one-line "chain" for an unconnected node).
  const chainEdgeCount = useMemo(
    () => getEdgesWithinNodeSet(model, chainNodeIds).length,
    [chainNodeIds, model]
  );
  const chainOrder = useMemo(
    () => (chainEdgeCount > 0 ? getChainOrder(model, chainNodeIds) : []),
    [chainEdgeCount, chainNodeIds, model]
  );
  // The chain card only appears for a selected node that has upstream relations.
  const showChain = activeSelectedNodeId !== null && chainEdgeCount > 0;

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
          <span className="text-[11px] font-medium text-[var(--z-text-3)]">
            {nodes.length}{" "}
            {mode === "all" ? t("graph.nodes") : t("graph.truths")}
          </span>
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
          />
        </div>
      </section>

      {showChain ? (
        // Chain = the wide bottom card. It now holds a compact text derivation
        // (premises ▷ at the top → the selected node ✓ at the bottom), each line
        // clickable, joined by arrow connectors — no more block-and-arrow SVG.
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
              {chainNodeIds.size} {t("graph.steps")}
            </span>
          </div>
          <ul
            aria-label={t("graph.chainAria")}
            className="min-h-0 flex-1 list-none overflow-y-auto px-2 pb-3"
          >
            {chainOrder.map((nodeId, index) => {
              const node = model.nodeById.get(nodeId);

              if (!node) {
                return null;
              }

              return (
                <li key={nodeId}>
                  {index > 0 ? (
                    // Text connector between steps: "↓ needs" reads like a
                    // hand-written derivation and keeps related lines tight.
                    <div
                      aria-hidden="true"
                      className="flex items-center gap-1.5 py-0.5 pl-3.5 text-[var(--z-edge-label)]"
                    >
                      <span className="leading-none text-[var(--z-confirmed)]">
                        ↓
                      </span>
                      <span className="text-[11px]">{t("graph.chainNeeds")}</span>
                    </div>
                  ) : null}
                  <ChainRow
                    isRoot={chainRootIds.has(nodeId)}
                    isSelected={activeSelectedNodeId === nodeId}
                    node={node}
                    onSelect={onSelect}
                  />
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
