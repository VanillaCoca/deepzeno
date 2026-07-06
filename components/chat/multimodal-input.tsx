"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import equal from "fast-deep-equal";
import {
  ArrowUpIcon,
  BrainIcon,
  GaugeIcon,
  Loader2Icon,
  PlusIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { useLocale } from "@/components/i18n/locale-provider";
import { IRBulkImportDialog } from "@/components/ir/ir-bulk-import-dialog";
import { useQuality } from "@/components/quality/quality-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  type ChatModel,
  chatModels,
  DEFAULT_CHAT_MODEL,
  type ModelCapabilities,
} from "@/lib/ai/models";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { Button } from "../ui/button";
import { StopIcon } from "./icons";
import { PreviewAttachment } from "./preview-attachment";
import {
  type SlashCommand,
  SlashCommandMenu,
  slashCommands,
} from "./slash-commands";
import type { VisibilityType } from "./visibility-selector";

function setCookie(name: string, value: string) {
  const maxAge = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: needed for client-side cookie setting
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
}

// The logo already shows the vendor, so drop a trailing provider qualifier like
// " (Bedrock)" / " (DeepSeek)" from the displayed name — keep the picker to just
// logo + model name.
function displayModelName(name?: string) {
  if (!name) {
    return "";
  }
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim() || name;
}

function getSlashInvocation(value: string) {
  const slashIndex = value.lastIndexOf("/");

  if (slashIndex === -1) {
    return null;
  }

  const before = value.slice(0, slashIndex);
  const query = value.slice(slashIndex + 1);

  if (slashIndex > 0 && !/\s$/.test(before)) {
    return null;
  }

  if (/\s/.test(query)) {
    return null;
  }

  return {
    contentBeforeSlash: before.trimEnd(),
    query,
    slashIndex,
  };
}

function PureMultimodalInput({
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages: _messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType: _selectedVisibilityType,
  selectedModelId,
  onModelChange,
  editingMessage,
  onCancelEdit,
  isLoading,
}: {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage:
    | UseChatHelpers<ChatMessage>["sendMessage"]
    | (() => Promise<void>);
  className?: string;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  editingMessage?: ChatMessage | null;
  onCancelEdit?: () => void;
  isLoading?: boolean;
}) {
  const { t } = useLocale();
  const {
    activeProjectId,
    activeTopicId,
    currentConversationId,
    consumeReferenceDraft,
    referenceDraft,
  } = useWorkspace();
  const { mutate } = useSWRConfig();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const hasAutoFocused = useRef(false);
  const [shouldHighlightInput, setShouldHighlightInput] = useState(false);
  useEffect(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
    }
  }, [localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  useEffect(() => {
    if (!referenceDraft) {
      return;
    }

    const draft = consumeReferenceDraft();
    if (!draft) {
      return;
    }

    const selectionStart = textareaRef.current?.selectionStart ?? input.length;
    const selectionEnd = textareaRef.current?.selectionEnd ?? input.length;

    setInput((current) => {
      return `${current.slice(0, selectionStart)}${draft.text}${current.slice(selectionEnd)}`;
    });
    setShouldHighlightInput(true);
    textareaRef.current?.focus();

    requestAnimationFrame(() => {
      const cursor = selectionStart + draft.text.length;
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });

    const timeout = window.setTimeout(() => {
      setShouldHighlightInput(false);
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [consumeReferenceDraft, input.length, referenceDraft, setInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = event.target.value;
    setInput(val);

    const slashInvocation = getSlashInvocation(val);

    if (slashInvocation) {
      setSlashOpen(true);
      setSlashQuery(slashInvocation.query);
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  };

  function isSlashCommandDisabled(cmd: SlashCommand) {
    const slashInvocation = getSlashInvocation(input);

    return cmd.action === "save" && !slashInvocation?.contentBeforeSlash.trim();
  }

  async function saveInputAsCandidate(contentBeforeSlash: string) {
    const content = contentBeforeSlash.trim();

    if (!content) {
      return;
    }

    if (!activeProjectId || !activeTopicId) {
      toast.error("Workspace is still loading. Please try again in a moment.");
      return;
    }

    const firstLine = content.split(/\r?\n/)[0] ?? "";
    const title = firstLine.slice(0, 60).trim() || content.slice(0, 60).trim();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/ir/draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: activeProjectId,
          topic_id: activeTopicId,
          kind: "unclassified",
          title,
          content,
          source_layer: "manual",
          created_by: "user",
          initial_status: "pending",
        }),
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.cause ?? payload?.message ?? "Save failed.");
    }

    setInput("");
    setLocalStorageInput("");
    await mutate(
      (key) => typeof key === "string" && key.includes("/api/ir?"),
      undefined,
      { revalidate: true }
    );
    toast.success("Saved as candidate.");
  }

  const handleSlashSelect = async (cmd: SlashCommand) => {
    const slashInvocation = getSlashInvocation(input);

    if (isSlashCommandDisabled(cmd)) {
      return;
    }

    setSlashOpen(false);

    switch (cmd.action) {
      case "save":
        try {
          await saveInputAsCandidate(slashInvocation?.contentBeforeSlash ?? "");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Save failed.");
        }
        break;
      case "model": {
        setInput(slashInvocation?.contentBeforeSlash ?? "");
        const modelBtn = document.querySelector<HTMLButtonElement>(
          "[data-testid='model-selector']"
        );
        modelBtn?.click();
        break;
      }
      default:
        break;
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  // True while a model switch is saving (POST default-model + workspace refresh).
  // The send button shows a spinner and submitting is blocked until it settles.
  const [isSwitchingModel, setIsSwitchingModel] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const isWorkspaceReady = Boolean(
    activeProjectId && activeTopicId && currentConversationId
  );

  const submitForm = useCallback(() => {
    if (!isWorkspaceReady || !currentConversationId) {
      toast.error("Workspace is still loading. Please try again in a moment.");
      return;
    }

    window.history.pushState(
      {},
      "",
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${currentConversationId}`
    );

    sendMessage({
      role: "user",
      parts: [
        ...attachments.map((attachment) => ({
          type: "file" as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
        })),
        {
          type: "text",
          text: input,
        },
      ],
    });

    setAttachments([]);
    setLocalStorageInput("");
    setInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    currentConversationId,
    isWorkspaceReady,
  ]);

  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/files/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch (_error) {
      toast.error("Failed to upload file, please try again!");
    }
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (_error) {
        toast.error("Failed to upload files");
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile]
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith("image/")
      );

      if (imageItems.length === 0) {
        return;
      }

      event.preventDefault();

      setUploadQueue((prev) => [...prev, "Pasted image"]);

      try {
        const uploadPromises = imageItems
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null)
          .map((file) => uploadFile(file));

        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) =>
            attachment !== undefined &&
            attachment.url !== undefined &&
            attachment.contentType !== undefined
        );

        setAttachments((curr) => [
          ...curr,
          ...(successfullyUploadedAttachments as Attachment[]),
        ]);
      } catch (_error) {
        toast.error("Failed to upload pasted image(s)");
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile]
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.addEventListener("paste", handlePaste);
    return () => textarea.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {editingMessage && onCancelEdit && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>Editing message</span>
          <button
            className="rounded px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              onCancelEdit();
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}

      <input
        className="pointer-events-none fixed -top-4 -left-4 size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <div className="relative">
        {slashOpen && (
          <SlashCommandMenu
            isDisabled={isSlashCommandDisabled}
            onClose={() => setSlashOpen(false)}
            onSelect={handleSlashSelect}
            query={slashQuery}
            selectedIndex={slashIndex}
          />
        )}
      </div>

      <PromptInput
        className={cn(
          "[&>div]:rounded-2xl [&>div]:border [&>div]:border-border/30 [&>div]:bg-card/70 [&>div]:shadow-[var(--shadow-composer)] [&>div]:transition-shadow [&>div]:duration-300",
          shouldHighlightInput &&
            "[&>div]:ring-2 [&>div]:ring-foreground/15 [&>div]:shadow-[var(--shadow-composer-focus)]"
        )}
        onSubmit={() => {
          if (isSwitchingModel) {
            return;
          }
          if (isLoading) {
            toast.error(
              "Workspace is still loading. Please try again in a moment."
            );
            return;
          }
          if (!isWorkspaceReady) {
            toast.error(
              "Workspace is still loading. Please try again in a moment."
            );
            return;
          }
          const slashInvocation = getSlashInvocation(input);
          if (slashInvocation) {
            const cmd = slashCommands.find(
              (c) => c.name === slashInvocation.query
            );
            if (cmd && !isSlashCommandDisabled(cmd)) {
              handleSlashSelect(cmd).catch(console.error);
              return;
            }

            if (cmd) {
              return;
            }
          }

          if (input.trim().startsWith("/")) {
            return;
          }
          if (!input.trim() && attachments.length === 0) {
            return;
          }
          if (status === "ready" || status === "error") {
            submitForm();
          } else {
            toast.error("Please wait for the model to finish its response!");
          }
        }}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            className="flex w-full self-start flex-row gap-2 overflow-x-auto px-3 pt-3 no-scrollbar"
            data-testid="attachments-preview"
          >
            {attachments.map((attachment) => (
              <PreviewAttachment
                attachment={attachment}
                key={attachment.url}
                onRemove={() => {
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url)
                  );
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                attachment={{
                  url: "",
                  name: filename,
                  contentType: "",
                }}
                isUploading={true}
                key={filename}
              />
            ))}
          </div>
        )}
        <PromptInputTextarea
          className="min-h-24 text-[13px] leading-relaxed px-4 pt-3.5 pb-1.5 placeholder:text-muted-foreground/35"
          data-testid="multimodal-input"
          disabled={Boolean(isLoading)}
          onChange={handleInput}
          onKeyDown={(e) => {
            if (slashOpen) {
              const filtered = slashCommands.filter((cmd) =>
                cmd.name.startsWith(slashQuery.toLowerCase())
              );
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => Math.min(i + 1, filtered.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const command = filtered[slashIndex];
                if (command && !isSlashCommandDisabled(command)) {
                  handleSlashSelect(command).catch(console.error);
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlashOpen(false);
                return;
              }
            }
            if (e.key === "Escape" && editingMessage && onCancelEdit) {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          placeholder={
            isLoading
              ? t("chat.loadingWorkspace")
              : editingMessage
                ? t("chat.editMessage")
                : t("chat.askAnything")
          }
          ref={textareaRef}
          value={input}
        />
        <PromptInputFooter className="px-3 pb-3">
          <PromptInputTools>
            <ComposerPlusMenu
              fileInputRef={fileInputRef}
              selectedModelId={selectedModelId}
              status={status}
            />
            <ModelSelectorCompact
              onModelChange={onModelChange}
              onSwitchingChange={setIsSwitchingModel}
              selectedModelId={selectedModelId}
            />
            <QualitySelector />
          </PromptInputTools>

          {status === "submitted" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className={cn(
                "h-7 w-7 rounded-xl transition-all duration-200",
                isSwitchingModel
                  ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                  : input.trim()
                    ? "bg-foreground text-background hover:opacity-85 active:scale-95"
                    : "bg-muted text-muted-foreground/25 cursor-not-allowed"
              )}
              data-testid="send-button"
              disabled={
                isSwitchingModel ||
                !input.trim() ||
                uploadQueue.length > 0 ||
                Boolean(isLoading) ||
                !isWorkspaceReady
              }
              status={status}
              variant="secondary"
            >
              {isSwitchingModel ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <ArrowUpIcon className="size-4" />
              )}
            </PromptInputSubmit>
          )}
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    if (prevProps.editingMessage !== nextProps.editingMessage) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.messages.length !== nextProps.messages.length) {
      return false;
    }

    return true;
  }
);

function ComposerPlusMenu({
  fileInputRef,
  status,
  selectedModelId,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>["status"];
  selectedModelId: string;
}) {
  const { activeProjectId, activeTopic, activeTopicId } = useWorkspace();
  const [importOpen, setImportOpen] = useState(false);

  const { data: modelsResponse } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  const caps: Record<string, ModelCapabilities> | undefined =
    modelsResponse?.capabilities ?? modelsResponse;
  const hasVision = caps?.[selectedModelId]?.vision ?? false;
  const importDisabled =
    !activeProjectId || !activeTopicId || Boolean(activeTopic?.archivedAt);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Add attachment or import"
            className="h-7 w-7 rounded-lg border border-border/40 p-1 text-muted-foreground hover:text-foreground"
            data-testid="composer-plus"
            variant="ghost"
          >
            <PlusIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            disabled={status !== "ready" || !hasVision}
            onSelect={() => fileInputRef.current?.click()}
          >
            Attach file
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={importDisabled}
            onSelect={() => setImportOpen(true)}
          >
            Import decisions
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IRBulkImportDialog
        disabled={importDisabled}
        hideTrigger
        onOpenChange={setImportOpen}
        open={importOpen}
      />
    </>
  );
}

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
  onSwitchingChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  onSwitchingChange?: (switching: boolean) => void;
}) {
  const { activeTopicId, refreshWorkspace } = useWorkspace();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const selectingModelRef = useRef<string | null>(null);
  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  const capabilities: Record<string, ModelCapabilities> | undefined =
    modelsData?.capabilities ?? modelsData;
  const dynamicModels: ChatModel[] | undefined = modelsData?.models;
  const activeModels = dynamicModels ?? chatModels;

  const isAuto = selectedModelId === "auto";

  const selectedModel =
    activeModels.find((m: ChatModel) => m.id === selectedModelId) ??
    activeModels.find((m: ChatModel) => m.id === DEFAULT_CHAT_MODEL) ??
    activeModels[0];

  const handleModelSelect = useCallback(
    (modelId: string) => {
      // Re-selecting the current model (or one already being switched to) is a
      // no-op: just close the menu, no save / no switching animation.
      if (
        modelId === selectedModelId ||
        selectingModelRef.current === modelId
      ) {
        setOpen(false);
        return;
      }

      selectingModelRef.current = modelId;
      setIsSwitching(true);
      onSwitchingChange?.(true);
      onModelChange?.(modelId);
      setCookie("chat-model", modelId);
      setOpen(false);
      setTimeout(() => {
        document
          .querySelector<HTMLTextAreaElement>(
            "[data-testid='multimodal-input']"
          )
          ?.focus();
      }, 50);

      const savePreference = activeTopicId
        ? fetch(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/topics/${activeTopicId}/default-model`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ modelId }),
            }
          ).then((response) => {
            if (!response.ok) {
              throw new Error("Model preference was not saved.");
            }
            return refreshWorkspace();
          })
        : Promise.resolve();

      savePreference
        .catch((error) => {
          console.error(error);
          toast.error(
            error instanceof Error
              ? error.message
              : "Model preference was not saved."
          );
        })
        .finally(() => {
          selectingModelRef.current = null;
          setIsSwitching(false);
          onSwitchingChange?.(false);
        });
    },
    [
      activeTopicId,
      onModelChange,
      onSwitchingChange,
      refreshWorkspace,
      selectedModelId,
    ]
  );

  if (!(selectedModel || isAuto)) {
    return null;
  }

  return (
    <>
      {/* Keep every vendor logo mounted + cached so the menu shows them
          instantly — without this they fetch only when the menu first opens,
          giving a brief flash of missing logos. */}
      <span aria-hidden className="hidden">
        {Array.from(
          new Set((dynamicModels ?? chatModels).map((m) => m.provider))
        ).map((provider) => (
          <ModelSelectorLogo key={provider} provider={provider} />
        ))}
      </span>
      <ModelSelector onOpenChange={setOpen} open={open}>
        <ModelSelectorTrigger asChild>
          <Button
            className="h-7 max-w-[200px] justify-between gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            data-testid="model-selector"
            variant="ghost"
          >
            {isSwitching ? (
              <>
                <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
                <ModelSelectorName className="animate-pulse text-muted-foreground">
                  {isAuto
                    ? t("chat.autoModel")
                    : displayModelName(selectedModel?.name)}
                </ModelSelectorName>
              </>
            ) : isAuto ? (
              <ModelSelectorName>{t("chat.autoModel")}</ModelSelectorName>
            ) : (
              <>
                <ModelSelectorLogo provider={selectedModel?.provider} />
                <ModelSelectorName>
                  {displayModelName(selectedModel?.name)}
                </ModelSelectorName>
              </>
            )}
          </Button>
        </ModelSelectorTrigger>
        <ModelSelectorContent>
          {/* Auto is a plain button (not a cmdk item) so it is always clickable. */}
          <button
            className="mx-1 mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted/50"
            data-testid="model-selector-auto"
            onClick={() => handleModelSelect("auto")}
            type="button"
          >
            <span className="flex-1 truncate">{t("chat.autoModel")}</span>
            <span className="text-[11px] text-muted-foreground">
              {t("chat.autoModelHint")}
            </span>
          </button>
          <ModelSelectorList>
            {/* Flat list — no per-vendor headings; the logo conveys the vendor. */}
            <ModelSelectorGroup>
              {(dynamicModels ?? chatModels).map((model) => (
                <ModelSelectorItem
                  className={cn(
                    "flex w-full",
                    model.id === selectedModel?.id && "bg-muted/50"
                  )}
                  data-testid="model-selector-item"
                  key={model.id}
                  onClick={() => handleModelSelect(model.id)}
                  onSelect={() => handleModelSelect(model.id)}
                  value={model.id}
                >
                  <ModelSelectorLogo provider={model.provider} />
                  <ModelSelectorName>
                    {displayModelName(model.name)}
                  </ModelSelectorName>
                  {capabilities?.[model.id]?.reasoning && (
                    <BrainIcon className="ml-auto size-3.5 text-foreground/70" />
                  )}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          </ModelSelectorList>
        </ModelSelectorContent>
      </ModelSelector>
    </>
  );
}

const ModelSelectorCompact = memo(PureModelSelectorCompact);

// Thinking-depth control, sat next to the model picker in the composer footer
// (moved here from the account menu). It steers the cost/quality of the Auto
// router; for an explicitly picked model the server ignores it.
function QualitySelector() {
  const { quality, setQuality } = useQuality();
  const { t } = useLocale();

  const label =
    quality === "economy"
      ? t("chat.qualityEconomy")
      : quality === "best"
        ? t("chat.qualityBest")
        : t("chat.qualityBalanced");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-7 gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          type="button"
          variant="ghost"
        >
          <GaugeIcon className="size-3.5 shrink-0" />
          <span className="max-w-[120px] truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel className="font-normal text-[11px] text-muted-foreground/70">
          {t("chat.quality")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) =>
            setQuality(value as "economy" | "balanced" | "best")
          }
          value={quality}
        >
          <DropdownMenuRadioItem value="economy">
            {t("chat.qualityEconomy")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="balanced">
            {t("chat.qualityBalanced")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="best">
            {t("chat.qualityBest")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  return (
    <Button
      className="h-7 w-7 rounded-xl bg-foreground p-1 text-background transition-all duration-200 hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/25 disabled:cursor-not-allowed"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
