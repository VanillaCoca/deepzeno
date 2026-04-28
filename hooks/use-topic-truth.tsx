"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import useSWR, { type KeyedMutator } from "swr";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { fetcher } from "@/lib/utils";
import type { WorkspaceTruthSnapshot } from "@/lib/workspace/types";

type TopicTruthContextValue = {
  activeTopicId: string | null;
  isGeneralTopic: boolean;
  isLoading: boolean;
  snapshot: WorkspaceTruthSnapshot | null;
  mutate: KeyedMutator<WorkspaceTruthSnapshot>;
};

const TopicTruthContext = createContext<TopicTruthContextValue | null>(null);

export function getTopicTruthSnapshotKey(topicId: string | null) {
  if (!topicId) {
    return null;
  }

  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/decisions?topicId=${topicId}`;
}

export function TopicTruthProvider({ children }: { children: ReactNode }) {
  const { activeTopic, activeTopicId, setPendingCount, workspace } =
    useWorkspace();
  const isGeneralTopic = Boolean(activeTopic?.isGeneral);
  const bootstrapSnapshot =
    workspace?.activeTopicId === activeTopicId ? workspace.truthSnapshot : null;

  const { data, isLoading, mutate } = useSWR<WorkspaceTruthSnapshot>(
    activeTopicId && !isGeneralTopic
      ? getTopicTruthSnapshotKey(activeTopicId)
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
      .channel(`topic-truth:${activeTopicId}`)
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

  const value = useMemo<TopicTruthContextValue>(
    () => ({
      activeTopicId,
      isGeneralTopic,
      isLoading,
      snapshot: data ?? null,
      mutate,
    }),
    [activeTopicId, data, isGeneralTopic, isLoading, mutate]
  );

  return (
    <TopicTruthContext.Provider value={value}>
      {children}
    </TopicTruthContext.Provider>
  );
}

export function useTopicTruth() {
  const context = useContext(TopicTruthContext);

  if (!context) {
    throw new Error("useTopicTruth must be used within TopicTruthProvider");
  }

  return context;
}
