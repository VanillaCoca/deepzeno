"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { toastBillingRefusal } from "@/components/billing/billing-refusal";
import { useProviderKeys } from "@/components/billing/provider-keys-provider";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { useLocale } from "@/components/i18n/locale-provider";
import { useQuality } from "@/components/quality/quality-provider";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import type { Vote } from "@/lib/db/schema";
import { isIRListKeyForScope } from "@/lib/ir/client-keys";
import type { ChatMessage } from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: VisibilityType;
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  showCreditCardAlert: boolean;
  setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
  // Id of the last message folded into the auto-compaction summary, if any.
  compactedThroughMessageId: string | null;
  modelByMessageId: Record<string, string>;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const { setDataStream } = useDataStream();
  const { mutate } = useSWRConfig();
  const {
    activeProjectId,
    activeTopic,
    activeTopicId,
    currentConversationId,
    isArchivedTopicReadonly,
    isLoading: isWorkspaceLoading,
    consumeInjectedDecisionContext,
    sandboxNavPending,
    endSandboxNav,
    setActiveConversationEmpty,
  } = useWorkspace();
  const { locale } = useLocale();
  const { quality } = useQuality();

  // Keep the latest locale in a ref so the transport closure always sends the
  // current language without rebuilding the transport.
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const qualityRef = useRef(quality);
  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);

  // Read through a ref for the same reason as the two above: `onError` is
  // handed to useChat once and outlives this render.
  const providerKeys = useProviderKeys();
  const providerKeysRef = useRef(providerKeys);
  useEffect(() => {
    providerKeysRef.current = providerKeys;
  }, [providerKeys]);

  const fallbackChatIdRef = useRef(generateUUID());
  const chatId = currentConversationId ?? fallbackChatIdRef.current;
  const isWorkspaceReady = Boolean(
    activeProjectId &&
      activeTopicId &&
      currentConversationId &&
      !isWorkspaceLoading
  );

  const [currentModelId, setCurrentModelIdState] = useState(DEFAULT_CHAT_MODEL);
  const [userDefaultModelId, setUserDefaultModelId] = useState<string | null>(
    null
  );
  const setCurrentModelId = useCallback((id: string) => {
    setCurrentModelIdState(id);
    setUserDefaultModelId(id);
  }, []);
  const currentModelIdRef = useRef(currentModelId);
  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  useEffect(() => {
    const cookieModel = document.cookie
      .split("; ")
      .find((row) => row.startsWith("chat-model="))
      ?.split("=")[1];

    if (cookieModel) {
      const decodedModel = decodeURIComponent(cookieModel);
      setUserDefaultModelId(decodedModel);
      setCurrentModelIdState(decodedModel);
    }
  }, []);

  const [input, setInput] = useState("");
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
  const activeTopicIdRef = useRef<string | null>(activeTopicId);
  const activeTopicIsGeneralRef = useRef(Boolean(activeTopic?.isGeneral));
  // Mirror the active selection into refs so the transport closure (built once,
  // never rebuilt) always posts the CURRENT project/topic/conversation. Reading
  // these from state inside the closure captured stale (often null) values right
  // after a fresh entry or topic switch, which made the first send race and fail
  // — same reasoning as localeRef/qualityRef above.
  const activeProjectIdRef = useRef<string | null>(activeProjectId);
  const currentConversationIdRef = useRef<string | null>(currentConversationId);

  useEffect(() => {
    activeTopicIdRef.current = activeTopicId;
    activeTopicIsGeneralRef.current = Boolean(activeTopic?.isGeneral);
    activeProjectIdRef.current = activeProjectId;
    currentConversationIdRef.current = currentConversationId;
  }, [
    activeProjectId,
    activeTopic?.isGeneral,
    activeTopicId,
    currentConversationId,
  ]);

  function scheduleIRRefresh(projectId: string | null, topicId: string | null) {
    if (!projectId || !topicId) {
      return;
    }

    const delays = [1500, 4000, 7000];

    for (const delay of delays) {
      window.setTimeout(() => {
        mutate((key) =>
          isIRListKeyForScope({
            key,
            projectId,
            topicId,
          })
        ).catch(console.error);
      }, delay);
    }
  }

  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  const preferredModelSeed =
    activeTopic?.defaultModelId ??
    userDefaultModelId ??
    modelsData?.defaultModelId ??
    DEFAULT_CHAT_MODEL;

  useEffect(() => {
    // "auto" is an explicit, valid pseudo-selection — never auto-correct away
    // from it (e.g. during the async window where the topic's stored default
    // model hasn't refreshed to "auto" yet).
    if (currentModelId === "auto") {
      return;
    }
    const availableModelIds = new Set<string>([
      ...(modelsData?.models ?? []).map((model: { id: string }) => model.id),
      "auto",
    ]);
    const defaultModelId = modelsData?.defaultModelId as string | undefined;
    const candidates = [preferredModelSeed, defaultModelId, DEFAULT_CHAT_MODEL];
    let preferredModelId: string | null = null;

    for (const candidate of candidates) {
      if (
        candidate &&
        (availableModelIds.size === 0 || availableModelIds.has(candidate))
      ) {
        preferredModelId = candidate;
        break;
      }
    }

    if (
      preferredModelId &&
      preferredModelId !== currentModelId &&
      (availableModelIds.size === 0 || availableModelIds.has(preferredModelId))
    ) {
      setCurrentModelIdState(preferredModelId);
    }
  }, [
    currentModelId,
    modelsData?.defaultModelId,
    modelsData?.models,
    preferredModelSeed,
  ]);

  const { data: chatData, isLoading } = useSWR(
    isWorkspaceReady
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const initialMessages: ChatMessage[] = chatData?.messages ?? [];
  const visibility: VisibilityType = chatData?.visibility ?? "private";
  const visibilityRef = useRef(visibility);
  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);
  const compactedThroughMessageId: string | null =
    chatData?.compaction?.compactedThroughMessageId ?? null;
  const modelByMessageId: Record<string, string> = chatData?.models ?? {};

  // After a "bring to sandbox" hand-off, drop the blocking veil once the
  // conversation (with its prior history) is ready to use.
  useEffect(() => {
    if (sandboxNavPending && isWorkspaceReady && !isLoading) {
      endSandboxNav();
    }
  }, [sandboxNavPending, isWorkspaceReady, isLoading, endSandboxNav]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse,
  } = useChat<ChatMessage>({
    id: chatId,
    messages: initialMessages,
    generateId: generateUUID,
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const lastMessage = currentMessages.at(-1);
      return (
        lastMessage?.parts?.some(
          (part) =>
            "state" in part &&
            part.state === "approval-responded" &&
            "approval" in part &&
            (part.approval as { approved?: boolean })?.approved === true
        ) ?? false
      );
    },
    transport: new DefaultChatTransport({
      api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);
        const isToolApprovalContinuation =
          lastMessage?.role !== "user" ||
          request.messages.some((msg) =>
            msg.parts?.some((part) => {
              const state = (part as { state?: string }).state;
              return (
                state === "approval-responded" || state === "output-denied"
              );
            })
          );

        return {
          body: {
            id: request.id,
            ...(isToolApprovalContinuation
              ? { messages: request.messages }
              : { message: lastMessage }),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityRef.current,
            projectId: activeProjectIdRef.current,
            topicId: activeTopicIdRef.current,
            conversationId: currentConversationIdRef.current,
            injectedDecisionContext: isToolApprovalContinuation
              ? undefined
              : consumeInjectedDecisionContext(),
            locale: localeRef.current,
            qualityPreference: qualityRef.current,
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));

      if (!activeTopicIsGeneralRef.current) {
        scheduleIRRefresh(activeProjectId, activeTopicIdRef.current);
      }
    },
    onError: (error) => {
      if (error.message?.includes("AI Gateway requires a valid credit card")) {
        setShowCreditCardAlert(true);
        return;
      }

      // A refusal for money is the one failure in this product the user can
      // clear themselves in thirty seconds — and the one the whole cost model
      // depends on them clearing. It gets a toast that stays up and carries
      // the button; see toastBillingRefusal for why both.
      if (
        toastBillingRefusal(error, providerKeysRef.current?.openProviderKeys)
      ) {
        return;
      }

      // Everything else: a ChatbotError already carries a written sentence,
      // and anything else falls back to one.
      toast({
        type: "error",
        description: error.message || "Oops, an error occurred!",
      });
    },
  });

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      setMessages([]);
    }
  }, [chatId, setMessages]);

  useEffect(() => {
    if (chatData?.messages) {
      setMessages(chatData.messages);
    }
  }, [chatData?.messages, setMessages]);

  // Bridge the live emptiness of the active conversation up to the workspace so
  // the header can disable "Explore new idea" on a blank page — exploring from
  // an empty conversation only spawns another blank one. setState bails when the
  // boolean is unchanged, so this doesn't re-render on every streamed token.
  useEffect(() => {
    setActiveConversationEmpty(messages.length === 0);
  }, [messages.length, setActiveConversationEmpty]);

  useEffect(() => {
    if (!currentConversationId) {
      return;
    }

    const nextPath = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${currentConversationId}`;

    if (window.location.pathname !== nextPath) {
      window.history.replaceState({}, "", nextPath);
    }
  }, [currentConversationId]);

  const hasAppendedQueryRef = useRef(false);
  useEffect(() => {
    if (!isWorkspaceReady) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const query = params.get("query");
    if (query && !hasAppendedQueryRef.current) {
      hasAppendedQueryRef.current = true;
      window.history.replaceState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });
    }
  }, [sendMessage, chatId, isWorkspaceReady]);

  useAutoResume({
    autoResume: isWorkspaceReady && !!chatData,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isArchivedTopicReadonly || (chatData?.isReadonly ?? false);
  const isChatLoading = isWorkspaceLoading || !isWorkspaceReady || isLoading;

  const { data: votes } = useSWR<Vote[]>(
    !isReadonly && messages.length >= 2
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      setInput,
      visibilityType: visibility,
      isReadonly,
      isLoading: isChatLoading,
      votes,
      currentModelId,
      setCurrentModelId,
      showCreditCardAlert,
      setShowCreditCardAlert,
      compactedThroughMessageId,
      modelByMessageId,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      visibility,
      isReadonly,
      isChatLoading,
      votes,
      currentModelId,
      setCurrentModelId,
      showCreditCardAlert,
      compactedThroughMessageId,
      modelByMessageId,
    ]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
