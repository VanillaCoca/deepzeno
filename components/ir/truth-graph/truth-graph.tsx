"use client";

import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
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

export type TruthGraphProps = {
  edges: TruthGraphFlowEdge["edge"][];
  nodes: IRNode[];
  onSelect: (nodeId: string) => void;
  selectedNodeId: string | null;
  topics: TruthGraphTopic[];
};

const OVERVIEW_DIMS = { width: 168, baseFont: 13, padY: 9 };
const CHAIN_DIMS = { width: 218, baseFont: 13, padY: 13 };
const NODE_MAX_LINES = 4;
const NODE_SHRINK_FONT = 11.5;

// Reserve text is stable per node (worst-case indicator width) so a node's
// height never changes when it becomes selected/root — avoids relayout jitter.
function nodeReserveText(node: IRNode) {
  return `✓ ${node.kind === "open_question" ? " ?" : ""}`;
}

function measureNode(
  node: IRNode,
  dims: { width: number; baseFont: number; padY: number }
) {
  return fitNodeTitle({
    title: node.title,
    width: dims.width,
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
      children: group.nodes.map((node) => ({
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

function elbowPath(from: NodeBox, to: NodeBox) {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const middleY = y1 + Math.max(18, (y2 - y1) / 2);

  return `M${x1} ${y1} L${x1} ${middleY} L${x2} ${middleY} L${x2} ${y2}`;
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

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
}

function chainEdgeLabelPoint(edge: ElkEdge) {
  const section = edge.sections?.[0];

  if (!section) {
    return null;
  }

  const points = [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
  ];
  const middle = points[Math.floor(points.length / 2)];

  return {
    x: middle.x,
    y: middle.y,
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
  if (node.status === "superseded" || node.kind === "rejection") {
    return {
      stroke: "var(--z-rejected)",
      text: "var(--z-rejected)",
      decoration: "line-through",
    };
  }

  if (node.kind === "open_question") {
    return {
      stroke: "var(--z-attention)",
      text: "var(--z-attention-text)",
      decoration: "none",
    };
  }

  if (isOnChain || isSelected) {
    return {
      stroke: "var(--z-confirmed)",
      text: "var(--z-confirmed)",
      decoration: "none",
    };
  }

  if (node.kind === "constraint" || node.kind === "hypothesis") {
    return {
      stroke: "var(--z-fact-stroke)",
      text: "var(--z-text-2)",
      decoration: "none",
    };
  }

  return {
    stroke: "var(--z-node-stroke)",
    text: "var(--z-text)",
    decoration: "none",
  };
}

function isDiamond(node: IRNode) {
  return node.kind === "open_question";
}

function GraphNode({
  box,
  hasSelection,
  isOnChain,
  isRoot,
  isSelected,
  node,
  onSelect,
}: {
  box: NodeBox;
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
  const { lines, fontPx, lineHeight } = measureNode(node, dims);
  const displayPrefix = isRoot ? "▷ " : isSelected ? "✓ " : "";
  const displaySuffix = node.kind === "open_question" ? " ?" : "";
  const renderLines = lines.map(
    (line, index) =>
      `${index === 0 ? displayPrefix : ""}${line}${index === lines.length - 1 ? displaySuffix : ""}`
  );
  const cx = box.x + box.width / 2;
  const blockTop = box.y + (box.height - lines.length * lineHeight) / 2;
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
      className="cursor-pointer"
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
      {isDiamond(node) ? (
        <polygon
          fill="var(--z-node-fill)"
          points={`${box.x + box.width / 2},${box.y} ${box.x + box.width},${box.y + box.height / 2} ${box.x + box.width / 2},${box.y + box.height} ${box.x},${box.y + box.height / 2}`}
          stroke={tone.stroke}
          strokeWidth={strokeWidth}
        />
      ) : (
        <rect
          fill="var(--z-node-fill)"
          height={box.height}
          rx={
            isRoot
              ? "var(--z-start-radius)"
              : isSelected
                ? "var(--z-node-radius-target)"
                : "var(--z-node-radius)"
          }
          stroke={tone.stroke}
          strokeWidth={strokeWidth}
          width={box.width}
          x={box.x}
          y={box.y}
        />
      )}
      <text
        dominantBaseline="central"
        fill={tone.text}
        fontFamily="var(--z-font-sans)"
        fontSize={fontPx}
        fontWeight={isSelected ? "600" : "500"}
        textAnchor="middle"
        textDecoration={tone.decoration}
      >
        {renderLines.map((line, index) => (
          <tspan
            // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable for a given title
            key={index}
            x={cx}
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
  edges,
  nodes,
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
  const chainNodeIds = useMemo(
    () => getUpstreamNodeIds(model, activeSelectedNodeId),
    [activeSelectedNodeId, model]
  );
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
    <div
      className="grid min-h-[360px] grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] overflow-hidden border-y border-[var(--z-topic-border)]"
      data-testid="truth-graph"
      style={{ color: "var(--z-text)", fontFamily: "var(--z-font-sans)" }}
    >
      <div className="sr-only" data-testid="truth-graph-text-index">
        {nodes.map((node) => (
          <span key={node.id}>{node.title}</span>
        ))}
      </div>
      <section
        className="min-w-0 border-r border-[var(--z-topic-border)] bg-[var(--z-bg)]"
        data-testid="truth-graph-overview"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--z-text-3)]">
          <span>Overview</span>
          <span className="normal-case">{nodes.length} truths</span>
        </div>
        <div className="flex justify-center overflow-auto">
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
                  <path
                    d="M2 1L8 5L2 9"
                    fill="none"
                    stroke="var(--z-confirmed)"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="var(--z-line-w-strong)"
                  />
                </marker>
              </defs>
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
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </section>

      <section
        className={cn(
          "min-w-0 bg-[var(--z-node-fill)]",
          !activeSelectedNodeId && "flex flex-col"
        )}
        data-testid="truth-graph-chain"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--z-text-3)]">
          <span>Chain</span>
          {activeSelectedNodeId ? (
            <span className="normal-case">{chainNodeIds.size} steps</span>
          ) : null}
        </div>
        {activeSelectedNodeId && layout.chain ? (
          <div className="flex justify-center overflow-auto">
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
                    <path
                      d="M2 1L8 5L2 9"
                      fill="none"
                      stroke="var(--z-confirmed)"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="var(--z-line-w-strong)"
                    />
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
                          textAnchor="middle"
                          x={labelPoint.x}
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
        ) : (
          <div className="flex flex-1 items-center px-4 py-8 text-sm leading-[1.6] text-[var(--z-text-3)]">
            Select a node in the overview to see the upstream reasoning chain.
          </div>
        )}
      </section>
    </div>
  );
}
