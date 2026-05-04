"use client";

import { SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { fetcher } from "@/lib/utils";
import type { WorkspaceCandidateDecision } from "@/lib/workspace/types";

function buildLabel(
  candidates: WorkspaceCandidateDecision[],
  agentName: string
) {
  const pending = candidates.filter(
    (candidate) => candidate.status === "pending"
  );
  const accepted = candidates.filter(
    (candidate) => candidate.status === "accepted"
  );
  const rejected = candidates.filter(
    (candidate) => candidate.status === "rejected"
  );

  if (pending.length > 0) {
    return `+${pending.length} from ${agentName}`;
  }

  if (accepted.length > 0) {
    return `✓ ${accepted.length} from ${agentName} confirmed`;
  }

  return `${rejected.length} from ${agentName} reviewed`;
}

export function AgentCandidateHint({
  topicId,
  disabled = false,
}: {
  topicId: string | null;
  disabled?: boolean;
}) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const { data, mutate } = useSWR<{ candidates: WorkspaceCandidateDecision[] }>(
    topicId && !disabled
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/candidates?topicId=${topicId}&source=mcp_agent&includeReviewed=true`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval:
        topicId && !disabled && !isSupabaseConfigured() ? 4000 : 0,
    }
  );

  useEffect(() => {
    if (!topicId || disabled || !isSupabaseConfigured()) {
      return;
    }

    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`agent-candidate-hint:${topicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "candidate_decisions",
          filter: `topic_id=eq.${topicId}`,
        },
        () => {
          mutate().catch(console.error);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(console.error);
    };
  }, [disabled, mutate, topicId]);

  const groups = useMemo(() => {
    const sourceCandidates = (data?.candidates ?? []).filter(
      (candidate) => candidate.source === "mcp_agent"
    );
    const grouped = new Map<string, WorkspaceCandidateDecision[]>();

    for (const candidate of sourceCandidates) {
      const agentName =
        typeof candidate.sourceMetadata?.agent === "string"
          ? candidate.sourceMetadata.agent
          : "External Agent";
      grouped.set(agentName, [...(grouped.get(agentName) ?? []), candidate]);
    }

    return [...grouped.entries()]
      .map(([agentName, candidates]) => ({
        agentName,
        candidates: [...candidates].sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt)
        ),
      }))
      .filter(({ candidates }) => candidates.length > 0)
      .sort((left, right) =>
        right.candidates[0].createdAt.localeCompare(
          left.candidates[0].createdAt
        )
      );
  }, [data?.candidates]);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map(({ agentName, candidates }) => {
        const isExpanded = expandedAgent === agentName;
        const pendingCount = candidates.filter(
          (candidate) => candidate.status === "pending"
        ).length;

        return (
          <div
            className="overflow-hidden rounded-2xl border border-amber-500/20 bg-amber-500/5 text-xs text-muted-foreground shadow-[var(--shadow-card)] animate-[fade-up_0.5s_cubic-bezier(0.22,1,0.36,1)]"
            key={agentName}
          >
            <button
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left font-mono transition-colors hover:bg-amber-500/5 hover:text-foreground"
              onClick={() =>
                setExpandedAgent((current) =>
                  current === agentName ? null : agentName
                )
              }
              type="button"
            >
              <span className="flex items-center gap-2">
                <SparklesIcon className="size-3 text-amber-700" />
                {buildLabel(candidates, agentName)}
              </span>
              {pendingCount > 0 ? (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                  pending
                </span>
              ) : null}
            </button>

            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <div className="flex flex-col gap-2 border-t border-amber-500/15 px-3 py-3">
                  {candidates.map((candidate) => (
                    <div
                      className="rounded-xl bg-background/70 px-3 py-2"
                      key={candidate.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-foreground">
                          {candidate.proposedTitle ?? "Untitled candidate"}
                        </p>
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {candidate.proposedKind ?? "plan"}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                        {candidate.proposedContent}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
