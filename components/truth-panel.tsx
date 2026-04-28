"use client";

import { DecisionDetail } from "@/components/decision-detail";
import { DecisionTree } from "@/components/decision-tree";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { useTopicTruth } from "@/hooks/use-topic-truth";

export function TruthPanel() {
  const { selectedDecisionId, setSelectedDecisionId } = useWorkspace();
  const { isGeneralTopic, isLoading, mutate, snapshot } = useTopicTruth();

  const selectedDecision =
    snapshot?.decisions.find(
      (decision) => decision.id === selectedDecisionId
    ) ?? null;

  return (
    <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <DecisionTree
          decisions={snapshot?.decisions ?? []}
          edges={snapshot?.edges ?? []}
          emptyStateDescription={
            isGeneralTopic
              ? "General is chat-only. Switch to another topic to build a decision tree."
              : undefined
          }
          isLoading={isLoading}
        />
      </div>

      <DecisionDetail
        decision={selectedDecision}
        decisions={snapshot?.decisions ?? []}
        edges={snapshot?.edges ?? []}
        onClose={() => setSelectedDecisionId(null)}
        onUpdated={(next) => mutate(next, false)}
      />
    </div>
  );
}
