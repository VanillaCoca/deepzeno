"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { CandidatePool } from "@/components/candidate-pool";
import { DecisionDetail } from "@/components/decision-detail";
import { DecisionTree } from "@/components/decision-tree";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { fetcher } from "@/lib/utils";
import type { WorkspaceTruthSnapshot } from "@/lib/workspace/types";

export function TruthPanel() {
  const {
    activeTopic,
    activeTopicId,
    selectedDecisionId,
    setSelectedDecisionId,
    setPendingCount,
    workspace,
  } = useWorkspace();
  const isGeneralTopic = Boolean(activeTopic?.isGeneral);

  const bootstrapSnapshot =
    workspace?.activeTopicId === activeTopicId ? workspace.truthSnapshot : null;

  const { data, mutate, isLoading } = useSWR<WorkspaceTruthSnapshot>(
    activeTopicId && !isGeneralTopic
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/decisions?topicId=${activeTopicId}`
      : null,
    fetcher,
    {
      fallbackData: bootstrapSnapshot ?? undefined,
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnMount: false,
      refreshInterval:
        activeTopicId && !isGeneralTopic && !isSupabaseConfigured() ? 4000 : 0,
    }
  );

  useEffect(() => {
    if (activeTopicId && isGeneralTopic) {
      setPendingCount(activeTopicId, 0);
      return;
    }

    if (!activeTopicId || !data) {
      return;
    }

    setPendingCount(activeTopicId, data.pendingCandidates.length);
  }, [activeTopicId, data, isGeneralTopic, setPendingCount]);

  useEffect(() => {
    if (!activeTopicId || isGeneralTopic || !isSupabaseConfigured()) {
      return;
    }

    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`truth-panel:${activeTopicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "candidate_decisions",
          filter: `topic_id=eq.${activeTopicId}`,
        },
        () => {
          mutate().catch(console.error);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "decisions",
          filter: `topic_id=eq.${activeTopicId}`,
        },
        () => {
          mutate().catch(console.error);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "edges",
          filter: `topic_id=eq.${activeTopicId}`,
        },
        () => {
          mutate().catch(console.error);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(console.error);
    };
  }, [activeTopicId, isGeneralTopic, mutate]);

  const selectedDecision =
    data?.decisions.find((decision) => decision.id === selectedDecisionId) ??
    null;

  return (
    <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-4">
        {isGeneralTopic ? (
          <section className="flex min-h-[220px] flex-1 flex-col rounded-2xl border border-border/60 bg-background/85 p-5 shadow-[var(--shadow-card)]">
            <p className="text-sm font-semibold text-foreground">Truth Panel</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              General topic is intentionally chat-only. It does not run decision
              extraction, so the Candidate Pool and decision tree stay empty
              here.
            </p>
            <div className="mt-4 rounded-2xl border border-dashed border-border/60 bg-card/50 px-4 py-4 text-sm text-muted-foreground">
              Switch to a non-General topic to capture decisions, review
              candidates, and build the truth graph.
            </div>
          </section>
        ) : (
          <>
            <CandidatePool
              candidates={data?.pendingCandidates ?? []}
              isLoading={isLoading}
              onUpdated={(next) => mutate(next, false)}
              topicId={activeTopicId}
            />

            <DecisionTree
              decisions={data?.decisions ?? []}
              edges={data?.edges ?? []}
              isLoading={isLoading}
            />
          </>
        )}
      </div>

      <DecisionDetail
        decision={selectedDecision}
        decisions={data?.decisions ?? []}
        edges={data?.edges ?? []}
        onClose={() => setSelectedDecisionId(null)}
        onUpdated={(next) => mutate(next, false)}
      />
    </div>
  );
}
