"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useActiveChat } from "@/hooks/use-active-chat";
import type { Attachment, ChatMessage } from "@/lib/types";
import { useWorkspace } from "../workspace/workspace-provider";
import { DataStreamHandler } from "./data-stream-handler";
import { submitEditedMessage } from "./message-editor";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";

export function ChatShell() {
  const { restoredSandboxContext, clearRestoredSandboxContext } =
    useWorkspace();
  const { t } = useLocale();
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    votes,
    currentModelId,
    setCurrentModelId,
    showCreditCardAlert,
    setShowCreditCardAlert,
    compactedThroughMessageId,
    modelByMessageId,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setEditingMessage(null);
      setAttachments([]);
    }
  }, [chatId]);

  return (
    <>
      <div className="flex h-full w-full flex-row overflow-hidden">
        <div className="flex w-full min-w-0 flex-col bg-sidebar">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40">
            <Messages
              chatId={chatId}
              compactedThroughMessageId={compactedThroughMessageId}
              isLoading={isLoading}
              isReadonly={isReadonly}
              messages={messages}
              modelByMessageId={modelByMessageId}
              onEditMessage={(msg) => {
                const text = msg.parts
                  ?.filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join("");
                setInput(text ?? "");
                setEditingMessage(msg);
              }}
              regenerate={regenerate}
              selectedModelId={currentModelId}
              setMessages={setMessages}
              status={status}
              votes={votes}
            />

            <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
              {!isReadonly && (
                <div className="flex w-full flex-col gap-3">
                  {restoredSandboxContext && (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">
                            {t("chat.sandboxNextMessage", {
                              title: restoredSandboxContext.decisionTitle,
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("chat.sandboxNextMessageHint")}
                          </p>
                        </div>
                        <button
                          className="text-xs text-muted-foreground underline underline-offset-4"
                          onClick={clearRestoredSandboxContext}
                          type="button"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}

                  <MultimodalInput
                    attachments={attachments}
                    editingMessage={editingMessage}
                    input={input}
                    isLoading={isLoading}
                    messages={messages}
                    onCancelEdit={() => {
                      setEditingMessage(null);
                      setInput("");
                    }}
                    onModelChange={setCurrentModelId}
                    selectedModelId={currentModelId}
                    selectedVisibilityType={visibilityType}
                    sendMessage={
                      editingMessage
                        ? async () => {
                            const msg = editingMessage;
                            setEditingMessage(null);
                            await submitEditedMessage({
                              message: msg,
                              text: input,
                              setMessages,
                              regenerate,
                            });
                            setInput("");
                          }
                        : sendMessage
                    }
                    setAttachments={setAttachments}
                    setInput={setInput}
                    setMessages={setMessages}
                    status={status}
                    stop={stop}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <DataStreamHandler />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.open(
                  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
                  "_blank"
                );
                window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
