"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fitNodeTitle } from "@/lib/ir/fit-title";
import type { IRNode } from "@/lib/ir/types";
import { getIRTypeLabel, truncateIRTitle } from "@/lib/ir/types";
import { cn } from "@/lib/utils";
import {
  buildTruthGraphModel,
  getChainRootIds,
  getEdgesWithinNodeSet,
  getUpstreamNodeIds,
  type TruthGraphFlowEdge,
  type TruthGraphModel,
  type TruthGraphTopic,
} from "./data";

type ElkChild = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkChild[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
};

type ElkEdge = {
  id: string;
  sources: string[];
  targets: string[];
  sections?: Array<{
    startPoint: ElkPoint;
    endPoint: ElkPoint;
    bendPoints?: ElkPoint[];
  }>;
};

type ElkPoint = {
  x: number;
  y: number;
};

type ElkGraph = ElkChild & {
  children: ElkChild[];
  edges?: ElkEdge[];
};

type NodeBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutState = {
  overview: ElkGraph | null;
  chain: ElkGraph | null;
};

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
  selectedNodeId: string | null;
  topics: TruthGraphTopic[];
};

const OVERVIEW_DIMS = { width: 236, baseFont: 13, padY: 10, padX: 14 };
const CHAIN_DIMS = { width: 276, baseFont: 13, padY: 12, padX: 16 };
const NODE_MAX_LINES = 4;
const NODE_SHRINK_FONT = 11.5;

// Reserve text is stable per node (worst-case indicator width) so a node's
// height never changes when it becomes selected/root — avoids relayout jitter.
function nodeReserveText(node: IRNode) {
  return `✓ ${node.kind === "open_question" ? " ?" : ""}`;
}

function measureNode(
  node: IRNode,
  dims: { width: number; baseFont: number; padY: number; padX: number }
) {
  return fitNodeTitle({
    title: node.title,
    // Reserve horizontal padding on both sides so left-aligned text never
    // touches the node edges.
    width: dims.width - dims.padX * 2,
    baseFont: dims.baseFont,
    reserveText: nodeReserveText(node),
    padY: dims.padY,
    maxLines: NODE_MAX_LINES,
    shrinkFont: NODE_SHRINK_FONT,
  });
}

const GRAPH_MIN_NODE_COUNT = 3;
const CHAIN_EDGE_LABEL = "needs";

// Overview groups nodes by Topic and draws no dependency lines by default
// (rules §1.1). With no edges, a `layered` root would drop every topic into a
// single layer and spread them along one horizontal row — an unreadable wide
// strip. `rectpacking` instead packs the topic containers into a stable grid.
const OVERVIEW_OPTIONS = {
  "elk.algorithm": "rectpacking",
  "elk.aspectRatio": "1.5",
  "elk.spacing.nodeNode": "18",
  "elk.padding": "[top=8,left=8,bottom=8,right=8]",
};

// Inside a topic there are no edges either, so `RIGHT` keeps every node in one
// layer stacked vertically (a tidy single column) rather than a horizontal row.
// considerModelOrder preserves the deterministic creation order from data.ts.
const TOPIC_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "10",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.padding": "[top=32,left=12,bottom=12,right=12]",
};

const CHAIN_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "30",
  "elk.layered.spacing.nodeNodeBetweenLayers": "46",
  "elk.padding": "[top=24,left=20,bottom=24,right=20]",
};

function createOverviewGraph(model: TruthGraphModel): ElkGraph {
  return {
    id: "truth-graph-overview-root",
    layoutOptions: OVERVIEW_OPTIONS,
    children: model.topicGroups.map((group) => ({
      id: topicLayoutId(group.topic.id),
      layoutOptions: TOPIC_OPTIONS,
      // Sub-nodes are not shown in the overview (they live in the detail panel
      // + chain), so we lay out roots only.
      children: group.nodes
        .filter((node) => !node.parentId)
        .map((node) => ({
          id: node.id,
          width: OVERVIEW_DIMS.width,
          height: measureNode(node, OVERVIEW_DIMS).height,
        })),
    })),
    edges: [],
  };
}

function createChainGraph(
  model: TruthGraphModel,
  chainNodeIds: Set<string>
): ElkGraph | null {
  if (chainNodeIds.size === 0) {
    return null;
  }

  const chainEdges = getEdgesWithinNodeSet(model, chainNodeIds);

  return {
    id: "truth-graph-chain-root",
    layoutOptions: CHAIN_OPTIONS,
    children: [...chainNodeIds].map((nodeId) => {
      const node = model.nodeById.get(nodeId);
      const height = node
        ? measureNode(node, CHAIN_DIMS).height
        : CHAIN_DIMS.padY * 2 + Math.round(CHAIN_DIMS.baseFont * 1.3);
      return { id: nodeId, width: CHAIN_DIMS.width, height };
    }),
    edges: chainEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.parentId],
      targets: [edge.childId],
    })),
  };
}

function topicLayoutId(topicId: string | null) {
  return `topic:${topicId ?? "unassigned"}`;
}

function absoluteBoxes(root: ElkChild) {
  const boxes = new Map<string, NodeBox>();

  function visit(node: ElkChild, offsetX: number, offsetY: number) {
    const x = offsetX + (node.x ?? 0);
    const y = offsetY + (node.y ?? 0);
    const width = node.width ?? 0;
    const height = node.height ?? 0;

    boxes.set(node.id, { id: node.id, x, y, width, height });

    for (const child of node.children ?? []) {
      visit(child, x, y);
    }
  }

  visit(root, 0, 0);
  return boxes;
}

// Orthogonal connector that always stops a gap OUTSIDE the target node and
// enters from whichever side faces the source, so the line never crosses the
// node body / text (overview nodes can sit in any relative position).
const EDGE_GAP = 7;

function elbowPath(from: NodeBox, to: NodeBox) {
  const fromCx = from.x + from.width / 2;
  const fromCy = from.y + from.height / 2;
  const toCx = to.x + to.width / 2;
  const toCy = to.y + to.height / 2;

  // Target clearly below the source → connect bottom → top.
  if (to.y >= from.y + from.height) {
    const y1 = from.y + from.height;
    const y2 = to.y - EDGE_GAP;
    const midY = y1 + Math.max(14, (y2 - y1) / 2);
    return `M${fromCx} ${y1} L${fromCx} ${midY} L${toCx} ${midY} L${toCx} ${y2}`;
  }

  // Target clearly above the source → connect top → bottom.
  if (to.y + to.height <= from.y) {
    const y1 = from.y;
    const y2 = to.y + to.height + EDGE_GAP;
    const midY = y1 + Math.min(-14, (y2 - y1) / 2);
    return `M${fromCx} ${y1} L${fromCx} ${midY} L${toCx} ${midY} L${toCx} ${y2}`;
  }

  // Otherwise they overlap vertically (side by side) → connect side → side.
  const goRight = toCx >= fromCx;
  const x1 = goRight ? from.x + from.width : from.x;
  const x2 = goRight ? to.x - EDGE_GAP : to.x + to.width + EDGE_GAP;
  const midX = (x1 + x2) / 2;
  return `M${x1} ${fromCy} L${midX} ${fromCy} L${midX} ${toCy} L${x2} ${toCy}`;
}

function chainEdgePath(edge: ElkEdge) {
  const section = edge.sections?.[0];

  if (!section) {
    return null;
  }

  const points = [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
  ];

  // Pull the final point back by EDGE_GAP so the solid arrowhead sits in the
  // gap just below the source / above the target, never overshooting into it.
  const last = points.at(-1);
  const prev = points.at(-2);
  if (last && prev) {
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    points[points.length - 1] = {
      x: last.x - (dx / len) * EDGE_GAP,
      y: last.y - (dy / len) * EDGE_GAP,
    };
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
}

// Label sits at the true geometric midpoint between the two node anchors — i.e.
// centered in the gap between nodes — so it reads consistently on every edge.
function chainEdgeLabelPoint(edge: ElkEdge) {
  const section = edge.sections?.[0];

  if (!section) {
    return null;
  }

  return {
    x: (section.startPoint.x + section.endPoint.x) / 2,
    y: (section.startPoint.y + section.endPoint.y) / 2,
  };
}

function nodeTone({
  isOnChain,
  isSelected,
  node,
}: {
  isOnChain: boolean;
  isSelected: boolean;
  node: IRNode;
}) {
  // Borderless filled "chips" (Claude-style): identity comes from a soft
  // background fill + text color, not a colored border. `stroke` is only used
  // for the selected ring + focus outline. Color-blind redundancy (rules §4.7)
  // is carried by non-color cues: strike-through (rejection), the "?" suffix
  // (open question), and the ◇/○ stage glyphs (candidate/idea) added in GraphNode.
  if (node.status === "superseded" || node.kind === "rejection") {
    return {
      fill: "var(--z-rejected-soft)",
      fillSel: "var(--z-rejected-fill-sel)",
      stroke: "var(--z-rejected)",
      text: "var(--z-rejected)",
      decoration: "line-through",
    };
  }

  if (node.kind === "open_question") {
    return {
      fill: "var(--z-attention-soft)",
      fillSel: "var(--z-attention-fill-sel)",
      stroke: "var(--z-attention)",
      text: "var(--z-attention-text)",
      decoration: "none",
    };
  }

  if (node.status === "idea") {
    return {
      fill: "var(--z-node-fill)",
      fillSel: "var(--z-node-fill-sel)",
      stroke: "var(--z-text-3)",
      text: "var(--z-text-3)",
      decoration: "none",
    };
  }

  if (node.status === "pending") {
    return {
      fill: "var(--z-candidate-soft)",
      fillSel: "var(--z-candidate-fill-sel)",
      stroke: "var(--z-candidate)",
      text: "var(--z-candidate-text)",
      decoration: "none",
    };
  }

  if (isOnChain || isSelected) {
    return {
      fill: "var(--z-confirmed-soft)",
      fillSel: "var(--z-confirmed-fill-sel)",
      stroke: "var(--z-confirmed)",
      text: "var(--z-confirmed)",
      decoration: "none",
    };
  }

  if (node.kind === "constraint" || node.kind === "hypothesis") {
    return {
      fill: "var(--z-node-fill)",
      fillSel: "var(--z-node-fill-sel)",
      stroke: "var(--z-fact-stroke)",
      text: "var(--z-text-2)",
      decoration: "none",
    };
  }

  return {
    fill: "var(--z-node-fill)",
    stroke: "var(--z-node-stroke)",
    text: "var(--z-text)",
    decoration: "none",
  };
}

function GraphNode({
  box,
  subNodeCount = 0,
  hasSelection,
  isOnChain,
  isRoot,
  isSelected,
  node,
  onSelect,
}: {
  box: NodeBox;
  subNodeCount?: number;
  hasSelection: boolean;
  isOnChain: boolean;
  isRoot: boolean;
  isSelected: boolean;
  node: IRNode;
  onSelect: (nodeId: string) => void;
}) {
  const tone = nodeTone({ isOnChain, isSelected, node });
  const strokeWidth = isSelected
    ? "var(--z-stroke-w-target)"
    : "var(--z-stroke-w)";
  const dims = box.width >= CHAIN_DIMS.width ? CHAIN_DIMS : OVERVIEW_DIMS;
  const measured = measureNode(node, dims);
  const { lines, fontPx, lineHeight } = measured;
  // Title keeps its original measured height; an expanded box is taller and the
  // children render in the reserved space below the title.
  const titleHeight = measured.height;
  // Stage glyph gives candidates/ideas a non-color cue (color-blind safety).
  const stageGlyph =
    node.status === "pending" ? "◇ " : node.status === "idea" ? "○ " : "";
  const displayPrefix = isRoot ? "▷ " : isSelected ? "✓ " : stageGlyph;
  const displaySuffix = node.kind === "open_question" ? " ?" : "";
  const renderLines = lines.map(
    (line, index) =>
      `${index === 0 ? displayPrefix : ""}${line}${index === lines.length - 1 ? displaySuffix : ""}`
  );
  const leftX = box.x + dims.padX;
  const blockTop = box.y + (titleHeight - lines.length * lineHeight) / 2;
  const anchorLabel = isRoot ? "from here" : null;
  const selectNode = () => onSelect(node.id);

  function handleKeyDown(event: KeyboardEvent<SVGGElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    selectNode();
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG graph nodes must remain in SVG coordinate space.
    <g
      aria-label={node.title}
      className="cursor-pointer outline-none [&:focus-visible>:first-child]:[stroke:var(--z-confirmed)] focus-visible:[outline:none]"
      data-testid={`truth-graph-node-${node.id}`}
      onClick={selectNode}
      onKeyDown={handleKeyDown}
      opacity={
        !hasSelection || isOnChain || isSelected
          ? "var(--z-focus-full)"
          : "var(--z-focus-faint)"
      }
      role="button"
      style={{ transition: "opacity var(--z-transition)" }}
      tabIndex={0}
    >
      <rect
        // Selection is shown by a stronger fill (no border); `stroke` stays
        // "none" except for the keyboard focus ring (via focus-visible CSS).
        fill={isSelected ? tone.fillSel : tone.fill}
        height={titleHeight}
        rx={
          isRoot
            ? "var(--z-start-radius)"
            : isSelected
              ? "var(--z-node-radius-target)"
              : "var(--z-node-radius)"
        }
        stroke="none"
        strokeWidth={strokeWidth}
        width={box.width}
        x={box.x}
        y={box.y}
      />
      <text
        dominantBaseline="central"
        fill={tone.text}
        fontFamily="var(--z-font-sans)"
        fontSize={fontPx}
        fontWeight={isSelected ? "600" : "500"}
        textAnchor="start"
        textDecoration={tone.decoration}
      >
        {renderLines.map((line, index) => (
          <tspan
            // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable for a given title
            key={index}
            x={leftX}
            y={blockTop + lineHeight / 2 + index * lineHeight}
          >
            {line}
          </tspan>
        ))}
      </text>
      {anchorLabel ? (
        <text
          fill="var(--z-text-3)"
          fontFamily="var(--z-font-sans)"
          fontSize="var(--z-font-anchor)"
          textAnchor="middle"
          x={box.x + box.width / 2}
          y={box.y - 6}
        >
          {anchorLabel}
        </text>
      ) : null}
      {subNodeCount > 0 ? (
        // Passive badge: signals "has N sub-nodes"; the sub-nodes themselves
        // live in the detail panel + chain when this node is selected.
        <g>
          <rect
            fill="var(--z-node-fill-sel)"
            height="16"
            rx="8"
            width="24"
            x={box.x + box.width - 30}
            y={box.y + (titleHeight - 16) / 2}
          />
          <text
            dominantBaseline="central"
            fill="var(--z-text-2)"
            fontFamily="var(--z-font-sans)"
            fontSize="var(--z-font-anchor)"
            textAnchor="middle"
            x={box.x + box.width - 18}
            y={box.y + titleHeight / 2}
          >
            {subNodeCount}
          </text>
        </g>
      ) : null}
    </g>
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
      className="border-y border-[var(--z-topic-border)]"
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
  selectedNodeId,
  topics,
}: TruthGraphProps) {
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
  const [layout, setLayout] = useState<LayoutState>({
    overview: null,
    chain: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function runLayout() {
      if (nodes.length === 0) {
        setLayout({ overview: null, chain: null });
        return;
      }

      const [{ default: ELK }] = await Promise.all([
        import("elkjs/lib/elk.bundled.js"),
      ]);
      const elk = new ELK();
      const overviewGraph = createOverviewGraph(model);
      const chainGraph = createChainGraph(model, chainNodeIds);
      const [overview, chain] = await Promise.all([
        elk.layout(overviewGraph),
        chainGraph ? elk.layout(chainGraph) : Promise.resolve(null),
      ]);

      if (!cancelled) {
        setLayout({
          overview: overview as ElkGraph,
          chain: chain as ElkGraph | null,
        });
      }
    }

    runLayout().catch((error) => {
      console.error("Failed to layout truth graph", error);
      if (!cancelled) {
        setLayout({ overview: null, chain: null });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [chainNodeIds, model, nodes.length]);

  if (nodes.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-[var(--ir-text-tertiary)]">
        No truth nodes yet.
      </p>
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

  const overviewBoxes = layout.overview
    ? absoluteBoxes(layout.overview)
    : new Map<string, NodeBox>();
  const chainBoxes = layout.chain
    ? absoluteBoxes(layout.chain)
    : new Map<string, NodeBox>();
  const selectedChainEdges = getEdgesWithinNodeSet(model, chainNodeIds);
  const overviewWidth = Math.max(1, layout.overview?.width ?? 420);
  const overviewHeight = Math.max(1, layout.overview?.height ?? 320);
  const chainWidth = Math.max(1, layout.chain?.width ?? 300);
  const chainHeight = Math.max(1, layout.chain?.height ?? 260);

  return (
    // The overview is the base canvas. The Chain and Detail+Action panels float
    // ABOVE it as inset rounded cards (only when a node is selected), so the
    // canvas stays free for browsing every IR when nothing is selected.
    // `--z-chain-w` drives both the Chain card width and the Detail card's right
    // edge, so the Detail card width matches the remaining overview region.
    <div
      className="relative h-full min-h-[360px] border-y border-[var(--z-topic-border)]"
      data-testid="truth-graph"
      style={
        {
          color: "var(--z-text)",
          fontFamily: "var(--z-font-sans)",
          "--z-chain-w": "clamp(280px, 30%, 360px)",
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
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--z-text-3)]">
          <span>Overview</span>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-[var(--z-topic-border)] p-0.5 normal-case">
              {(["truth", "all"] as const).map((scope) => (
                <button
                  aria-label={`Show ${scope === "truth" ? "truths only" : "all stages"}`}
                  aria-pressed={mode === scope}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    mode === scope
                      ? "bg-[var(--z-node-fill)] text-[var(--z-text)]"
                      : "text-[var(--z-text-3)] hover:text-[var(--z-text-2)]"
                  )}
                  key={scope}
                  onClick={() => onModeChange(scope)}
                  type="button"
                >
                  {scope === "truth" ? "Truth" : "All"}
                </button>
              ))}
            </div>
            <span className="normal-case">
              {nodes.length} {mode === "all" ? "nodes" : "truths"}
            </span>
          </div>
        </div>
        {mode === "all" ? (
          <div className="flex items-center gap-3 px-3 pb-1.5 text-[10px] text-[var(--z-text-3)]">
            {(
              [
                { color: "var(--z-confirmed)", label: "Truth" },
                { color: "var(--z-candidate)", label: "Candidate" },
                { color: "var(--z-text-3)", label: "Idea" },
              ] as const
            ).map((item) => (
              <span className="flex items-center gap-1" key={item.label}>
                <span
                  className="size-2 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-1 justify-center overflow-auto">
          <div className="min-w-max">
            <svg
              aria-label="Truth graph overview grouped by topic"
              height={overviewHeight}
              role="img"
              viewBox={`0 0 ${overviewWidth} ${overviewHeight}`}
              width={overviewWidth}
            >
              <defs>
                <marker
                  id="z-truth-overview-arrow"
                  markerHeight="7"
                  markerWidth="7"
                  orient="auto-start-reverse"
                  refX="8"
                  refY="5"
                  viewBox="0 0 10 10"
                >
                  <path d="M2 1L8 5L2 9Z" fill="var(--z-confirmed)" />
                </marker>
              </defs>
              {/* Full-canvas hit layer: clicking blank space (between/around
                  topics) clears the selection so both floating cards vanish and
                  the user can browse every IR. Nodes sit in sibling <g>s above,
                  so a node click never reaches this layer. */}
              {/* biome-ignore lint/a11y/useSemanticElements: background deselect target must live in SVG coordinate space. */}
              <rect
                aria-label="Clear selection"
                fill="transparent"
                height={overviewHeight}
                onClick={() => onSelect(null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(null);
                  }
                }}
                role="button"
                tabIndex={-1}
                width={overviewWidth}
                x={0}
                y={0}
              />
              {model.topicGroups.map((group) => {
                const box = overviewBoxes.get(topicLayoutId(group.topic.id));

                if (!box) {
                  return null;
                }

                return (
                  <g key={group.topic.id ?? "unassigned"}>
                    <rect
                      fill="none"
                      height={box.height}
                      rx="var(--z-node-radius-target)"
                      stroke="var(--z-topic-border)"
                      strokeWidth="var(--z-stroke-w-fact)"
                      width={box.width}
                      x={box.x}
                      y={box.y}
                    />
                    <text
                      fill="var(--z-text-2)"
                      fontFamily="var(--z-font-sans)"
                      fontSize="var(--z-font-topic)"
                      fontWeight="600"
                      x={box.x + 12}
                      y={box.y + 18}
                    >
                      {truncateIRTitle(group.topic.label, 28)}
                    </text>
                  </g>
                );
              })}
              {activeSelectedNodeId
                ? selectedChainEdges.map((edge) => {
                    const parentBox = overviewBoxes.get(edge.parentId);
                    const childBox = overviewBoxes.get(edge.childId);

                    if (!(parentBox && childBox)) {
                      return null;
                    }

                    return (
                      <path
                        d={elbowPath(parentBox, childBox)}
                        fill="none"
                        key={edge.id}
                        markerEnd="url(#z-truth-overview-arrow)"
                        opacity="var(--z-focus-related)"
                        stroke="var(--z-confirmed)"
                        strokeLinejoin="round"
                        strokeWidth="var(--z-line-w-strong)"
                      />
                    );
                  })
                : null}
              {nodes.map((node) => {
                const box = overviewBoxes.get(node.id);

                if (!box) {
                  return null;
                }

                const isSelected = activeSelectedNodeId === node.id;
                const isOnChain = chainNodeIds.has(node.id);

                return (
                  <GraphNode
                    box={box}
                    hasSelection={Boolean(activeSelectedNodeId)}
                    isOnChain={isOnChain}
                    isRoot={false}
                    isSelected={isSelected}
                    key={node.id}
                    node={node}
                    onSelect={onSelect}
                    subNodeCount={childrenByParent.get(node.id)?.length ?? 0}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </section>

      {activeSelectedNodeId && layout.chain ? (
        <aside
          className="absolute top-[var(--z-card-inset)] right-[var(--z-card-inset)] bottom-[var(--z-card-inset)] z-10 flex w-[var(--z-chain-w)] flex-col overflow-hidden rounded-[var(--z-card-radius)] border border-[var(--z-topic-border)] bg-[var(--z-card-bg)] shadow-[var(--z-card-shadow)]"
          data-testid="truth-graph-chain"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--z-text-3)]">
            <span>Chain</span>
            <span className="normal-case">{chainNodeIds.size} steps</span>
          </div>
          <div className="flex flex-1 justify-center overflow-auto">
            <div className="min-w-max">
              <svg
                aria-label="Selected truth upstream chain"
                height={chainHeight}
                role="img"
                viewBox={`0 0 ${chainWidth} ${chainHeight}`}
                width={chainWidth}
              >
                <defs>
                  <marker
                    id="z-truth-chain-arrow"
                    markerHeight="7"
                    markerWidth="7"
                    orient="auto-start-reverse"
                    refX="8"
                    refY="5"
                    viewBox="0 0 10 10"
                  >
                    <path d="M2 1L8 5L2 9Z" fill="var(--z-confirmed)" />
                  </marker>
                </defs>
                {layout.chain.edges?.map((edge) => {
                  const path = chainEdgePath(edge);
                  const labelPoint = chainEdgeLabelPoint(edge);

                  return path ? (
                    <g key={edge.id}>
                      <path
                        d={path}
                        fill="none"
                        markerEnd="url(#z-truth-chain-arrow)"
                        stroke="var(--z-confirmed)"
                        strokeLinejoin="round"
                        strokeWidth="var(--z-line-w-strong)"
                      />
                      {labelPoint ? (
                        <text
                          dominantBaseline="central"
                          fill="var(--z-edge-label)"
                          fontFamily="var(--z-font-sans)"
                          fontSize="var(--z-font-edge)"
                          fontWeight="500"
                          textAnchor="start"
                          x={labelPoint.x + 8}
                          y={labelPoint.y}
                        >
                          {CHAIN_EDGE_LABEL}
                        </text>
                      ) : null}
                    </g>
                  ) : null;
                })}
                {[...chainNodeIds].map((nodeId) => {
                  const node = model.nodeById.get(nodeId);
                  const box = chainBoxes.get(nodeId);

                  if (!(node && box)) {
                    return null;
                  }

                  return (
                    <GraphNode
                      box={box}
                      hasSelection={true}
                      isOnChain={true}
                      isRoot={chainRootIds.has(nodeId)}
                      isSelected={activeSelectedNodeId === nodeId}
                      key={nodeId}
                      node={node}
                      onSelect={onSelect}
                    />
                  );
                })}
              </svg>
            </div>
          </div>
        </aside>
      ) : null}

      {activeSelectedNodeId && detailSlot ? (
        // Detail+Action floating card. Pinned to the bottom-left and stretched
        // to the chain card's left edge, so its width matches the remaining
        // overview region (rules: details width == overview area width).
        <div
          className="absolute bottom-[var(--z-card-inset)] left-[var(--z-card-inset)] z-10 flex max-h-[58%] flex-col overflow-hidden rounded-[var(--z-card-radius)] border border-[var(--z-topic-border)] bg-[var(--z-card-bg)] shadow-[var(--z-card-shadow)]"
          data-testid="truth-graph-detail-card"
          style={{
            right:
              "calc(var(--z-chain-w) + var(--z-card-inset) + var(--z-card-inset))",
          }}
        >
          {detailSlot}
        </div>
      ) : null}
    </div>
  );
}
