"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { IRDetailPane } from "@/components/ir/ir-detail";
import { irNodeKey, useIR } from "@/components/ir/ir-provider";
import { TruthGraph } from "@/components/ir/truth-graph";
import { useIRActions } from "@/components/ir/use-ir-actions";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { IRDetail } from "@/lib/ir/types";
import { fetcher } from "@/lib/utils";

export function TruthGraphStage() {
  const { truth, truthEdges, selectedNodeId, selectNode } = useIR();
  const { topics } = useWorkspace();
  const { data: detail, mutate: mutateDetail } = useSWR<IRDetail>(
    irNodeKey(selectedNodeId),
    fetcher,
    { revalidateOnFocus: false }
  );

  // The stage's detail pane is scoped to TRUTH nodes only. Ideas/candidates
  // selected from the drawer share selectedNodeId but show their detail there,
  // not here.
  const selectedTruthNode =
    truth.find((node) => node.id === selectedNodeId) ?? null;
  const actions = useIRActions(selectedTruthNode, mutateDetail);
  const truthGraphTopics = useMemo(
    () => topics.map((topic) => ({ id: topic.id, label: topic.label })),
    [topics]
  );

  return (
    <div className="flex h-full flex-col" data-testid="truth-graph-stage">
      <div className="min-h-0 flex-1 overflow-auto">
        <TruthGraph
          edges={truthEdges}
          nodes={truth}
          onSelect={selectNode}
          selectedNodeId={selectedNodeId}
          topics={truthGraphTopics}
        />
      </div>
      {selectedTruthNode ? (
        <div className="h-2/5 min-h-[220px] overflow-auto border-t border-[var(--ir-border-default)]">
          <IRDetailPane
            actions={actions}
            detail={detail}
            selectedNode={selectedTruthNode}
          />
        </div>
      ) : null}
    </div>
  );
}
