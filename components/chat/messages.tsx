import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowDownIcon } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { KickoffBanner } from "@/components/kickoff/kickoff-banner";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { useMessages } from "@/hooks/use-messages";
import { chatModels } from "@/lib/ai/models";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";

function modelLabel(id: string): string {
  const known = chatModels.find((model) => model.id === id);
  if (known) {
    return known.name;
  }
  return id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
}

function ModelBadge({ label }: { label: string }) {
  return (
    <div className="mt-1 text-[11px] text-muted-foreground/45">{label}</div>
  );
}

type MessagesProps = {
  chatId: string;
  status: UseChatHelpers<ChatMessage>["status"];
  votes: Vote[] | undefined;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  isLoading?: boolean;
  selectedModelId: string;
  onEditMessage?: (message: ChatMessage) => void;
  compactedThroughMessageId?: string | null;
  modelByMessageId?: Record<string, string>;
};

function CompactionDivider({ label }: { label: string }) {
  return (
    <div className="flex select-none items-center gap-3 py-1 text-[11px] text-muted-foreground/45">
      <div className="h-px flex-1 bg-border/40" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  );
}

function PureMessages({
  chatId,
  status,
  votes,
  messages,
  setMessages,
  regenerate,
  isReadonly,
  isLoading,
  selectedModelId: _selectedModelId,
  onEditMessage,
  compactedThroughMessageId,
  modelByMessageId,
}: MessagesProps) {
  const { restoredSandboxContext } = useWorkspace();
  const { t } = useLocale();
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
    reset,
  } = useMessages({
    status,
  });

  const { dataStream } = useDataStream();
  const liveModel = (() => {
    for (let i = dataStream.length - 1; i >= 0; i -= 1) {
      if (dataStream[i].type === "data-model") {
        return dataStream[i].data as string;
      }
    }
    return null;
  })();

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      reset();
    }
  }, [chatId, reset]);

  return (
    <div className="relative flex-1 bg-background">
      {messages.length === 0 && !isLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Greeting />
        </div>
      )}
      <div
        className={cn(
          "absolute inset-0 touch-pan-y overflow-y-auto",
          messages.length > 0 ? "bg-background" : "bg-transparent"
        )}
        data-testid="messages-viewport"
        ref={messagesContainerRef}
      >
        <div className="mx-auto flex min-h-full min-w-0 max-w-4xl flex-col gap-5 px-2 py-6 pt-16 md:gap-7 md:px-4">
          {restoredSandboxContext && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-4 text-sm">
              <p className="font-medium text-foreground">
                {t("chat.sandboxNextMessage", {
                  title: restoredSandboxContext.decisionTitle,
                })}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {restoredSandboxContext.contextText}
              </p>
            </div>
          )}

          <KickoffBanner />

          {messages.map((message, index) => (
            <Fragment key={message.id}>
              <PreviewMessage
                chatId={chatId}
                isLoading={
                  status === "streaming" && messages.length - 1 === index
                }
                isReadonly={isReadonly}
                message={message}
                onEdit={onEditMessage}
                regenerate={regenerate}
                requiresScrollPadding={
                  hasSentMessage && index === messages.length - 1
                }
                setMessages={setMessages}
                vote={
                  votes
                    ? votes.find((vote) => vote.messageId === message.id)
                    : undefined
                }
              />
              {message.role === "assistant" &&
                (() => {
                  const modelId =
                    modelByMessageId?.[message.id] ??
                    (index === messages.length - 1 ? liveModel : null);
                  return modelId ? (
                    <ModelBadge
                      label={t("chat.answeredVia", {
                        model: modelLabel(modelId),
                      })}
                    />
                  ) : null;
                })()}
              {compactedThroughMessageId === message.id &&
                index < messages.length - 1 && (
                  <CompactionDivider label={t("chat.compactedDivider")} />
                )}
            </Fragment>
          ))}

          {status === "submitted" && messages.at(-1)?.role !== "assistant" && (
            <ThinkingMessage />
          )}

          <div
            className="min-h-[24px] min-w-[24px] shrink-0"
            ref={messagesEndRef}
          />
        </div>
      </div>

      <button
        aria-label="Scroll to bottom"
        className={`absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-full border border-border/50 bg-card/90 px-3.5 shadow-[var(--shadow-float)] backdrop-blur-lg transition-all duration-200 h-7 text-[10px] ${
          isAtBottom
            ? "pointer-events-none scale-90 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        }`}
        onClick={() => scrollToBottom("smooth")}
        type="button"
      >
        <ArrowDownIcon className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}

export const Messages = PureMessages;
