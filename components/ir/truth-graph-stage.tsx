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
  const { topics, activeProjectId } = useWorkspace();
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

  // "Truth" shows confirmed truths only; "All" overlays candidates + ideas so
  // the idea → candidate → truth pipeline is visible in one graph.
  const graphNodes = useMemo<IRNode[]>(() => {
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

  const graphEdges = useMemo<IREdge[]>(() => {
    if (graphMode !== "all") {
      return truthEdges;
    }

    const ids = new Set(graphNodes.map((node) => node.id));
    return (allEdgesData?.edges ?? []).filter(
      (edge) => ids.has(edge.fromNode) && ids.has(edge.toNode)
    );
  }, [graphMode, truthEdges, allEdgesData, graphNodes]);

  // The detail/action pane works for whatever node is selected in the graph —
  // in "All" mode that includes candidates/ideas, enabling inline promote/confirm.
  const selectedNode =
    graphNodes.find((node) => node.id === selectedNodeId) ?? null;
  const actions = useIRActions(selectedNode, mutateDetail);
  const truthGraphTopics = useMemo(
    () => topics.map((topic) => ({ id: topic.id, label: topic.label })),
    [topics]
  );

  return (
    <div className="flex h-full flex-col pt-16" data-testid="truth-graph-stage">
      <div className="min-h-0 flex-1 overflow-auto">
        <TruthGraph
          edges={graphEdges}
          mode={graphMode}
          nodes={graphNodes}
          onModeChange={setGraphMode}
          onSelect={selectNode}
          selectedNodeId={selectedNodeId}
          topics={truthGraphTopics}
        />
      </div>
      {selectedNode ? (
        <div className="h-2/5 min-h-[220px] overflow-auto border-t border-[var(--ir-border-default)]">
          <IRDetailPane
            actions={actions}
            detail={detail}
            selectedNode={selectedNode}
          />
        </div>
      ) : null}
    </div>
  );
}
