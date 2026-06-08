"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { IRDetailPane } from "@/components/ir/ir-detail";
import { irNodeKey, useIR } from "@/components/ir/ir-provider";
import { TruthGraph, type TruthGraphMode } from "@/components/ir/truth-graph";
import { useIRActions } from "@/components/ir/use-ir-actions";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { IRDetail, IREdge, IRNode } from "@/lib/ir/types";
import { fetcher } from "@/lib/utils";

export function TruthGraphStage() {
  const { truth, truthEdges, ideas, candidates, selectedNodeId, selectNode } =
    useIR();
  const { topics, activeProjectId, requestView } = useWorkspace();
  const [graphMode, setGraphMode] = useState<TruthGraphMode>("truth");

  const { data: detail, mutate: mutateDetail } = useSWR<IRDetail>(
    irNodeKey(selectedNodeId),
    fetcher,
    { revalidateOnFocus: false }
  );

  // In "all" mode we draw cross-stage edges, so we fetch every project edge and
  // filter to the visible node set. Only fetched while the mode is active.
  const { data: allEdgesData } = useSWR<{ edges: IREdge[] }>(
    graphMode === "all" && activeProjectId
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/ir/edges?project_id=${activeProjectId}`
      : null,
    fetcher
  );

  // Full node set for the current scope, before drill filtering. "Truth" shows
  // confirmed truths only; "All" overlays candidates + ideas.
  const baseNodes = useMemo<IRNode[]>(() => {
    if (graphMode !== "all") {
      return truth;
    }

    const seen = new Set<string>();
    return [...truth, ...candidates, ...ideas].filter((node) => {
      if (seen.has(node.id)) {
        return false;
      }
      seen.add(node.id);
      return true;
    });
  }, [graphMode, truth, candidates, ideas]);

  // Children grouped by parent — drives the count badge + the nested rows.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, IRNode[]>();
    for (const node of baseNodes) {
      if (node.parentId) {
        const list = map.get(node.parentId) ?? [];
        list.push(node);
        map.set(node.parentId, list);
      }
    }
    return map;
  }, [baseNodes]);

  // Pass the full set: the overview lays out roots and nests children inside
  // expanded parents, while the chain still resolves any node's upstream.
  const graphNodes = baseNodes;

  const graphEdges = useMemo<IREdge[]>(() => {
    const ids = new Set(graphNodes.map((node) => node.id));
    const base = graphMode === "all" ? (allEdgesData?.edges ?? []) : truthEdges;
    return base.filter(
      (edge) => ids.has(edge.fromNode) && ids.has(edge.toNode)
    );
  }, [graphMode, truthEdges, allEdgesData, graphNodes]);

  // The detail/action pane works for whatever node is selected (including a
  // nested child), enabling inline promote/confirm.
  const selectedNode =
    baseNodes.find((node) => node.id === selectedNodeId) ?? null;
  const actions = useIRActions(selectedNode, mutateDetail);
  const truthGraphTopics = useMemo(
    () => topics.map((topic) => ({ id: topic.id, label: topic.label })),
    [topics]
  );

  // The Detail+Action panel now floats over the overview as an inset card. We
  // hand it to TruthGraph as a slot so the graph positions it next to the Chain
  // card; both vanish together when nothing is selected (blank-canvas click).
  const detailSlot = selectedNode ? (
    <IRDetailPane
      actions={actions}
      detail={detail}
      selectedNode={selectedNode}
      subNodes={childrenByParent.get(selectedNode.id) ?? []}
    />
  ) : null;

  return (
    <div className="flex h-full flex-col pt-16" data-testid="truth-graph-stage">
      <div className="min-h-0 flex-1 overflow-hidden">
        <TruthGraph
          childrenByParent={childrenByParent}
          detailSlot={detailSlot}
          edges={graphEdges}
          mode={graphMode}
          nodes={graphNodes}
          onModeChange={setGraphMode}
          onSelect={selectNode}
          onStartConversation={() => requestView("conversation")}
          selectedNodeId={selectedNodeId}
          topics={truthGraphTopics}
        />
      </div>
    </div>
  );
}
