"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { type KeyedMutator } from "swr";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { getIRListKey, getUnassignedIRListKey } from "@/lib/ir/client-keys";
import type { IREdge, IRNode } from "@/lib/ir/types";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { fetcher } from "@/lib/utils";

type IRListPayload = {
  nodes: IRNode[];
  edges: IREdge[];
};

type IRContextValue = {
  selectedNodeId: string | null;
  selectNode: (nodeId: string | null) => void;
  ideas: IRNode[];
  candidates: IRNode[];
  unassignedIdeas: IRNode[];
  unassignedCandidates: IRNode[];
  truth: IRNode[];
  truthEdges: IREdge[];
  isLoading: boolean;
  mutateIdeas: KeyedMutator<IRListPayload>;
  mutateCandidates: KeyedMutator<IRListPayload>;
  mutateTruth: KeyedMutator<IRListPayload>;
  refreshIR: () => Promise<void>;
};

const EMPTY_PAYLOAD: IRListPayload = { nodes: [], edges: [] };
const IRContext = createContext<IRContextValue | null>(null);

export function irNodeKey(nodeId: string | null) {
  if (!nodeId) {
    return null;
  }

  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/ir/${nodeId}`;
}

export function IRProvider({ children }: { children: ReactNode }) {
  const { activeProjectId, activeTopicId, setPendingCount } = useWorkspace();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const scopedTopicId = activeTopicId;
  const ideaKey = getIRListKey({
    projectId: activeProjectId,
    topicId: scopedTopicId,
    status: "idea",
  });
  const candidateKey = getIRListKey({
    projectId: activeProjectId,
    topicId: scopedTopicId,
    status: "pending",
  });
  const truthKey = getIRListKey({
    projectId: activeProjectId,
    topicId: scopedTopicId,
    status: "active",
  });
  const unassignedIdeaKey = getUnassignedIRListKey({
    projectId: activeProjectId,
    status: "idea",
  });
  const unassignedCandidateKey = getUnassignedIRListKey({
    projectId: activeProjectId,
    status: "pending",
  });
  const {
    data: ideasPayload = EMPTY_PAYLOAD,
    isLoading: ideasLoading,
    mutate: mutateIdeas,
  } = useSWR<IRListPayload>(ideaKey, fetcher, {
    fallbackData: EMPTY_PAYLOAD,
    revalidateOnFocus: false,
  });
  const {
    data: candidatesPayload = EMPTY_PAYLOAD,
    isLoading: candidatesLoading,
    mutate: mutateCandidates,
  } = useSWR<IRListPayload>(candidateKey, fetcher, {
    fallbackData: EMPTY_PAYLOAD,
    revalidateOnFocus: false,
  });
  const {
    data: truthPayload = EMPTY_PAYLOAD,
    isLoading: truthLoading,
    mutate: mutateTruth,
  } = useSWR<IRListPayload>(truthKey, fetcher, {
    fallbackData: EMPTY_PAYLOAD,
    revalidateOnFocus: false,
  });
  const {
    data: unassignedIdeasPayload = EMPTY_PAYLOAD,
    isLoading: unassignedIdeasLoading,
    mutate: mutateUnassignedIdeas,
  } = useSWR<IRListPayload>(unassignedIdeaKey, fetcher, {
    fallbackData: EMPTY_PAYLOAD,
    revalidateOnFocus: false,
  });
  const {
    data: unassignedCandidatesPayload = EMPTY_PAYLOAD,
    isLoading: unassignedCandidatesLoading,
    mutate: mutateUnassignedCandidates,
  } = useSWR<IRListPayload>(unassignedCandidateKey, fetcher, {
    fallbackData: EMPTY_PAYLOAD,
    revalidateOnFocus: false,
  });
  const activeScopeKey = `${activeProjectId ?? ""}:${activeTopicId ?? ""}`;
  const previousScopeKeyRef = useRef(activeScopeKey);

  useEffect(() => {
    if (previousScopeKeyRef.current !== activeScopeKey) {
      previousScopeKeyRef.current = activeScopeKey;
      setSelectedNodeId(null);
    }
  }, [activeScopeKey]);

  useEffect(() => {
    if (activeTopicId) {
      setPendingCount(activeTopicId, candidatesPayload.nodes.length);
    }
  }, [activeTopicId, candidatesPayload.nodes.length, setPendingCount]);

  useEffect(() => {
    if (!activeProjectId || !isSupabaseConfigured()) {
      return;
    }

    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`ir-panel:${activeProjectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ir_nodes",
          filter: `project_id=eq.${activeProjectId}`,
        },
        () => {
          Promise.all([
            mutateIdeas(),
            mutateCandidates(),
            mutateTruth(),
            mutateUnassignedIdeas(),
            mutateUnassignedCandidates(),
          ]).catch(console.error);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ir_edges",
          filter: `project_id=eq.${activeProjectId}`,
        },
        () => {
          mutateTruth().catch(console.error);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(console.error);
    };
  }, [
    activeProjectId,
    mutateCandidates,
    mutateIdeas,
    mutateTruth,
    mutateUnassignedCandidates,
    mutateUnassignedIdeas,
  ]);

  const refreshIR = useCallback(async () => {
    await Promise.all([
      mutateIdeas(),
      mutateCandidates(),
      mutateTruth(),
      mutateUnassignedIdeas(),
      mutateUnassignedCandidates(),
    ]);
  }, [
    mutateCandidates,
    mutateIdeas,
    mutateTruth,
    mutateUnassignedCandidates,
    mutateUnassignedIdeas,
  ]);

  const value = useMemo<IRContextValue>(
    () => ({
      selectedNodeId,
      selectNode: setSelectedNodeId,
      ideas: ideasPayload.nodes,
      candidates: candidatesPayload.nodes,
      unassignedIdeas: unassignedIdeasPayload.nodes,
      unassignedCandidates: unassignedCandidatesPayload.nodes,
      truth: truthPayload.nodes,
      truthEdges: truthPayload.edges,
      isLoading:
        ideasLoading ||
        candidatesLoading ||
        truthLoading ||
        unassignedIdeasLoading ||
        unassignedCandidatesLoading,
      mutateIdeas,
      mutateCandidates,
      mutateTruth,
      refreshIR,
    }),
    [
      candidatesLoading,
      candidatesPayload.nodes,
      ideasLoading,
      ideasPayload.nodes,
      mutateCandidates,
      mutateIdeas,
      mutateTruth,
      refreshIR,
      selectedNodeId,
      truthLoading,
      truthPayload.edges,
      truthPayload.nodes,
      unassignedCandidatesLoading,
      unassignedCandidatesPayload.nodes,
      unassignedIdeasLoading,
      unassignedIdeasPayload.nodes,
    ]
  );

  return <IRContext.Provider value={value}>{children}</IRContext.Provider>;
}

export function useIR() {
  const context = useContext(IRContext);

  if (!context) {
    throw new Error("useIR must be used within IRProvider");
  }

  return context;
}
