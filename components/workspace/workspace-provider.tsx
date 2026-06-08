"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { fetcher } from "@/lib/utils";
import type {
  PendingCandidateCounts,
  WorkspaceBootstrap,
  WorkspaceConversation,
  WorkspaceProject,
  WorkspaceSelectionParams,
  WorkspaceTopic,
} from "@/lib/workspace/types";

type DraftInsertion = {
  nonce: number;
  text: string;
};

type InjectedSandboxContext = {
  nonce: number;
  decisionTitle: string;
  kind: string;
  contextText: string;
  consumeOnNextSend: boolean;
};

type WorkspaceViewName = "conversation" | "truth-graph";

type ViewRequest = { view: WorkspaceViewName; nonce: number };

type WorkspaceContextValue = {
  isLoading: boolean;
  workspace: WorkspaceBootstrap | null;
  projects: WorkspaceProject[];
  topics: WorkspaceTopic[];
  conversations: WorkspaceConversation[];
  activeProjectId: string | null;
  activeTopicId: string | null;
  currentConversationId: string | null;
  activeTopic: WorkspaceTopic | null;
  isArchivedTopicReadonly: boolean;
  pendingCandidateCounts: PendingCandidateCounts;
  selectProject: (projectId: string) => Promise<void>;
  selectTopic: (topicId: string) => Promise<void>;
  selectConversation: (conversationId: string) => void;
  createProject: (name: string) => Promise<void>;
  createTopic: (label: string) => Promise<void>;
  archiveTopic: (topicId: string) => Promise<void>;
  renameTopic: (topicId: string, label: string) => Promise<void>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  clearConversation: () => Promise<void>;
  goBack: () => void;
  goForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  refreshWorkspace: (selection?: WorkspaceSelectionParams) => Promise<void>;
  referenceDraft: DraftInsertion | null;
  queueReferenceDraft: (text: string) => void;
  consumeReferenceDraft: () => DraftInsertion | null;
  restoredSandboxContext: InjectedSandboxContext | null;
  bringDecisionToSandbox: (params: {
    decisionId: string;
    decisionTitle: string;
    kind: string;
    content: string;
    rationale?: string | null;
  }) => boolean;
  clearRestoredSandboxContext: () => void;
  consumeInjectedDecisionContext: () => string | null;
  setPendingCount: (topicId: string, count: number) => void;
  // Cross-cutting view switching: lets a deep component (e.g. the IR detail
  // action column) ask the shell to switch the Conversation/Truth-Graph view.
  viewRequest: ViewRequest | null;
  requestView: (view: WorkspaceViewName) => void;
  // True while a "bring to sandbox" hand-off to the conversation is in flight,
  // so the UI can show a blocking loading veil until the conversation is ready.
  sandboxNavPending: boolean;
  beginSandboxNav: () => void;
  endSandboxNav: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function extractConversationId(pathname: string) {
  const match = pathname.match(/\/chat\/([^/]+)/);
  if (!match || match[1] === "new") {
    return null;
  }

  return match[1];
}

function extractSelectionFromLocation(
  pathname: string,
  searchParams: URLSearchParams
): WorkspaceSelectionParams {
  return {
    projectId: searchParams.get("projectId"),
    topicId: searchParams.get("topicId"),
    conversationId: extractConversationId(pathname),
  };
}

function buildBootstrapUrl(selection: WorkspaceSelectionParams) {
  const params = new URLSearchParams();

  if (selection.projectId) {
    params.set("projectId", selection.projectId);
  }

  if (selection.topicId) {
    params.set("topicId", selection.topicId);
  }

  if (selection.conversationId) {
    params.set("conversationId", selection.conversationId);
  }

  const query = params.toString();
  const prefix = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/bootstrap`;

  return query ? `${prefix}?${query}` : prefix;
}

function selectionMatchesWorkspace(
  workspace: WorkspaceBootstrap | null,
  selection: WorkspaceSelectionParams
) {
  if (!workspace) {
    return false;
  }

  if (
    selection.projectId &&
    workspace.activeProjectId !== selection.projectId
  ) {
    return false;
  }

  if (selection.topicId && workspace.activeTopicId !== selection.topicId) {
    return false;
  }

  if (
    selection.conversationId &&
    workspace.currentConversationId !== selection.conversationId
  ) {
    return false;
  }

  return true;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const locationSelection = useMemo(
    () =>
      extractSelectionFromLocation(
        pathname,
        new URLSearchParams(searchParamsString)
      ),
    [pathname, searchParamsString]
  );
  const selectionRef = useRef<WorkspaceSelectionParams>(locationSelection);
  const [selection, setSelection] =
    useState<WorkspaceSelectionParams>(locationSelection);
  const [referenceDraft, setReferenceDraft] = useState<DraftInsertion | null>(
    null
  );
  const [restoredSandboxContext, setRestoredSandboxContext] =
    useState<InjectedSandboxContext | null>(null);
  const [viewRequest, setViewRequest] = useState<ViewRequest | null>(null);
  const [sandboxNavPending, setSandboxNavPending] = useState(false);
  const [pendingCandidateCounts, setPendingCandidateCounts] =
    useState<PendingCandidateCounts>({});

  const {
    data,
    isLoading: isBootstrapLoading,
    isValidating,
    mutate,
  } = useSWR<{ workspace: WorkspaceBootstrap }>(
    buildBootstrapUrl(selection),
    fetcher,
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      dedupingInterval: 1500,
    }
  );

  const workspace = data?.workspace ?? null;
  const projects = workspace?.projects ?? [];
  const topics = workspace?.topics ?? [];
  const conversations = workspace?.conversations ?? [];
  const activeProjectId = workspace?.activeProjectId ?? null;
  const activeTopicId = workspace?.activeTopicId ?? null;
  const currentConversationId = workspace?.currentConversationId ?? null;
  const activeTopic =
    topics.find((topic) => topic.id === activeTopicId) ?? null;
  const isSelectionPending = !selectionMatchesWorkspace(workspace, selection);
  const isLoading = isBootstrapLoading || (isValidating && isSelectionPending);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    selectionRef.current = locationSelection;
    setSelection(locationSelection);
  }, [locationSelection]);

  useEffect(() => {
    if (workspace) {
      setPendingCandidateCounts(workspace.pendingCandidateCounts);
    }
  }, [workspace]);

  useEffect(() => {
    if (!activeProjectId || !isSupabaseConfigured()) {
      return;
    }

    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`workspace-project:${activeProjectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "candidate_decisions",
          filter: `project_id=eq.${activeProjectId}`,
        },
        async () => {
          const selectionSnapshot = { ...selectionRef.current };
          const selectionUrl = buildBootstrapUrl(selectionSnapshot);
          const nextWorkspace = await fetcher(selectionUrl);

          if (selectionUrl !== buildBootstrapUrl(selectionRef.current)) {
            return;
          }

          await mutate(nextWorkspace, false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(console.error);
    };
  }, [activeProjectId, mutate]);

  async function refreshWorkspace(nextSelection?: WorkspaceSelectionParams) {
    if (nextSelection) {
      selectionRef.current = {
        ...selectionRef.current,
        ...nextSelection,
      };
      setSelection((current) => ({
        ...current,
        ...nextSelection,
      }));
      return;
    }

    await mutate();
  }

  async function postWorkspaceUpdate(
    path: string,
    body?: Record<string, unknown>
  ) {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : "{}",
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.cause ?? payload?.error ?? "Request failed");
    }

    return response.json();
  }

  async function selectProject(projectId: string) {
    await refreshWorkspace({ projectId, topicId: null, conversationId: null });
  }

  async function selectTopic(topicId: string) {
    await refreshWorkspace({
      projectId: activeProjectId,
      topicId,
      conversationId: null,
    });
  }

  function selectConversation(conversationId: string) {
    selectionRef.current = {
      ...selectionRef.current,
      projectId: activeProjectId,
      topicId: activeTopicId,
      conversationId,
    };
    setSelection((current) => ({
      ...current,
      projectId: activeProjectId,
      topicId: activeTopicId,
      conversationId,
    }));
  }

  async function createProject(name: string) {
    const payload = await postWorkspaceUpdate("/api/workspace/projects", {
      name,
    });
    await mutate(payload, false);
    selectionRef.current = {
      projectId: payload.workspace.activeProjectId,
      topicId: payload.workspace.activeTopicId,
      conversationId: payload.workspace.currentConversationId,
    };
    setSelection({
      projectId: payload.workspace.activeProjectId,
      topicId: payload.workspace.activeTopicId,
      conversationId: payload.workspace.currentConversationId,
    });
  }

  async function createTopic(label: string) {
    if (!activeProjectId) {
      throw new Error("Workspace project is not ready yet.");
    }

    const payload = await postWorkspaceUpdate("/api/workspace/topics", {
      projectId: activeProjectId,
      label,
    });
    await mutate(payload, false);
    selectionRef.current = {
      projectId: payload.workspace.activeProjectId,
      topicId: payload.workspace.activeTopicId,
      conversationId: payload.workspace.currentConversationId,
    };
    setSelection({
      projectId: payload.workspace.activeProjectId,
      topicId: payload.workspace.activeTopicId,
      conversationId: payload.workspace.currentConversationId,
    });
  }

  async function archiveTopic(topicId: string) {
    const payload = await postWorkspaceUpdate(
      `/api/workspace/topics/${topicId}/archive`
    );
    await mutate(payload, false);
    selectionRef.current = {
      projectId: payload.workspace.activeProjectId,
      topicId: payload.workspace.activeTopicId,
      conversationId: payload.workspace.currentConversationId,
    };
    setSelection({
      projectId: payload.workspace.activeProjectId,
      topicId: payload.workspace.activeTopicId,
      conversationId: payload.workspace.currentConversationId,
    });
  }

  async function renameTopic(topicId: string, label: string) {
    const payload = await postWorkspaceUpdate(
      `/api/workspace/topics/${topicId}/rename`,
      { label }
    );
    await mutate(payload, false);
  }

  async function renameProject(projectId: string, name: string) {
    const payload = await postWorkspaceUpdate(
      `/api/workspace/projects/${projectId}/rename`,
      { name }
    );
    await mutate(payload, false);
  }

  async function clearConversation() {
    if (!activeTopicId) {
      return;
    }

    const payload = await postWorkspaceUpdate(
      "/api/workspace/conversations/clear",
      {
        topicId: activeTopicId,
        conversationId: currentConversationId,
      }
    );
    await mutate(payload, false);
    selectionRef.current = {
      projectId: payload.workspace.activeProjectId,
      topicId: payload.workspace.activeTopicId,
      conversationId: payload.workspace.currentConversationId,
    };
    setSelection({
      projectId: payload.workspace.activeProjectId,
      topicId: payload.workspace.activeTopicId,
      conversationId: payload.workspace.currentConversationId,
    });
  }

  const currentConversationIndex = conversations.findIndex(
    (conversation) => conversation.id === currentConversationId
  );
  const canGoBack = currentConversationIndex > 0;
  const canGoForward =
    currentConversationIndex >= 0 &&
    currentConversationIndex < conversations.length - 1;

  function goBack() {
    if (!canGoBack) {
      return;
    }

    selectConversation(conversations[currentConversationIndex - 1].id);
  }

  function goForward() {
    if (!canGoForward) {
      return;
    }

    selectConversation(conversations[currentConversationIndex + 1].id);
  }

  function queueReferenceDraft(text: string) {
    setReferenceDraft({
      nonce: Date.now(),
      text,
    });
  }

  function consumeReferenceDraft() {
    const currentDraft = referenceDraft;
    setReferenceDraft(null);
    return currentDraft;
  }

  function bringDecisionToSandbox({
    decisionId: _decisionId,
    decisionTitle,
    kind,
    content,
    rationale,
  }: {
    decisionId: string;
    decisionTitle: string;
    kind: string;
    content: string;
    rationale?: string | null;
  }) {
    const normalizedContent = content.trim();

    if (!normalizedContent) {
      toast.error("This node does not have enough structured content yet.");
      return false;
    }

    const lines = [
      `[${kind}] ${decisionTitle}`,
      normalizedContent,
      rationale?.trim() ? `Because: ${rationale.trim()}` : null,
    ].filter(Boolean);

    setRestoredSandboxContext({
      nonce: Date.now(),
      decisionTitle,
      kind,
      contextText: lines.join("\n"),
      consumeOnNextSend: true,
    });

    return true;
  }

  function clearRestoredSandboxContext() {
    setRestoredSandboxContext(null);
  }

  function consumeInjectedDecisionContext() {
    if (!restoredSandboxContext?.consumeOnNextSend) {
      return null;
    }

    setRestoredSandboxContext((current) =>
      current
        ? {
            ...current,
            consumeOnNextSend: false,
          }
        : null
    );

    return restoredSandboxContext.contextText;
  }

  function setPendingCount(topicId: string, count: number) {
    setPendingCandidateCounts((current) => ({
      ...current,
      [topicId]: count,
    }));
  }

  function requestView(view: WorkspaceViewName) {
    setViewRequest({ view, nonce: Date.now() });
  }

  function beginSandboxNav() {
    setSandboxNavPending(true);
  }

  function endSandboxNav() {
    setSandboxNavPending(false);
  }

  const value: WorkspaceContextValue = {
    isLoading,
    workspace,
    projects,
    topics,
    conversations,
    activeProjectId,
    activeTopicId,
    currentConversationId,
    activeTopic,
    isArchivedTopicReadonly: workspace?.isArchivedTopicReadonly ?? false,
    pendingCandidateCounts,
    selectProject,
    selectTopic,
    selectConversation,
    createProject,
    createTopic,
    archiveTopic,
    renameTopic,
    renameProject,
    clearConversation,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    refreshWorkspace,
    referenceDraft,
    queueReferenceDraft,
    consumeReferenceDraft,
    restoredSandboxContext,
    bringDecisionToSandbox,
    clearRestoredSandboxContext,
    consumeInjectedDecisionContext,
    setPendingCount,
    viewRequest,
    requestView,
    sandboxNavPending,
    beginSandboxNav,
    endSandboxNav,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);

  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }

  return context;
}
