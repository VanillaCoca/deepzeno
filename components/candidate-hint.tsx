"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { fetcher } from "@/lib/utils";
import type { WorkspaceCandidateDecision } from "@/lib/workspace/types";

export function CandidateHint({
  messageId,
  disabled = false,
}: {
  messageId: string;
  disabled?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data, mutate } = useSWR<{ candidates: WorkspaceCandidateDecision[] }>(
    disabled
      ? null
      : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/candidates?messageId=${messageId}`,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: !disabled && !isSupabaseConfigured() ? 4000 : 0,
    }
  );

  useEffect(() => {
    if (disabled || !isSupabaseConfigured()) {
      return;
    }

    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`candidate-hint:${messageId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "candidate_decisions",
          filter: `message_id=eq.${messageId}`,
        },
        () => {
          mutate().catch(console.error);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(console.error);
    };
  }, [disabled, messageId, mutate]);

  const candidates = data?.candidates ?? [];

  if (candidates.length === 0) {
    return null;
  }

  const accepted = candidates.filter(
    (candidate) => candidate.status === "accepted"
  );
  const pending = candidates.filter(
    (candidate) => candidate.status === "pending"
  );
  const rejected = candidates.filter(
    (candidate) => candidate.status === "rejected"
  );
  const label =
    pending.length > 0
      ? `+${pending.length} candidate decision${pending.length === 1 ? "" : "s"}`
      : accepted.length > 0
        ? `✓ ${accepted.length} decision${accepted.length === 1 ? "" : "s"} confirmed`
        : `${rejected.length} candidate${rejected.length === 1 ? "" : "s"} reviewed`;

  return (
    <div className="mt-1 animate-[fade-up_0.5s_cubic-bezier(0.22,1,0.36,1)] text-xs text-muted-foreground/80">
      <button
        className="font-mono transition-colors hover:text-foreground"
        onClick={() => setIsExpanded((current) => !current)}
        type="button"
      >
        {label}
      </button>
      {isExpanded && pending.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-border/50 bg-card/70 px-3 py-2">
          <div className="flex flex-col gap-1.5">
            {pending.map((candidate) => (
              <div
                className="flex items-center gap-2 text-xs"
                key={candidate.id}
              >
                <span className="font-medium text-foreground">
                  {candidate.proposedTitle ?? "Untitled candidate"}
                </span>
                <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {candidate.proposedKind ?? "plan"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
