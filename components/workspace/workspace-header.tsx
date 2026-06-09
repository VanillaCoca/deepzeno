"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  MessagesSquareIcon,
  NetworkIcon,
  PanelLeftIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { useIR } from "@/components/ir/ir-provider";
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
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";

export type WorkspaceView = "conversation" | "truth-graph";

const ISLAND =
  "pointer-events-auto inline-flex h-9 items-center gap-1 rounded-xl border border-[var(--ir-border-default)] bg-[color-mix(in_srgb,var(--ir-bg-panel)_72%,transparent)] px-1.5 backdrop-blur-md";

export function WorkspaceHeader({
  view,
  onViewChange,
  onOpenDrawer,
}: {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  onOpenDrawer: () => void;
}) {
  const { toggleSidebar } = useSidebar();
  const { t } = useLocale();
  const { ideas, candidates } = useIR();
  const {
    activeTopic,
    activeProjectId,
    activeTopicId,
    currentConversationId,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    clearConversation,
  } = useWorkspace();
  const [exploreOpen, setExploreOpen] = useState(false);
  const [isExploring, setIsExploring] = useState(false);

  async function handleExplore() {
    if (!(activeProjectId && activeTopicId && currentConversationId)) {
      return;
    }
    setIsExploring(true);
    try {
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/sweep/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: activeProjectId,
          chat_session_id: currentConversationId,
          blocking: false,
        }),
      }).catch(console.error);
      await clearConversation();
      setExploreOpen(false);
    } finally {
      setIsExploring(false);
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-14">
      <div className="absolute top-2.5 left-3 flex items-center gap-2">
        <span className={cn(ISLAND, "pr-2.5")}>
          {/* Desktop toggles from inside the sidebar; this header trigger stays
              only on mobile, where the sidebar is a bottom sheet with no other
              way to open it. */}
          <Button
            aria-label={t("header.toggleSidebar")}
            className="md:hidden"
            onClick={toggleSidebar}
            size="icon-sm"
            variant="ghost"
          >
            <PanelLeftIcon className="size-4" />
          </Button>
          <span className="max-w-[200px] truncate text-sm font-medium text-[var(--ir-text-primary)]">
            <span className="mr-0.5 font-normal text-[var(--ir-text-tertiary)]">
              #
            </span>
            {activeTopic?.label ?? t("header.workspace")}
            {activeTopic?.archivedAt ? (
              <span className="ml-1.5 font-normal text-[var(--ir-text-tertiary)]">
                · {t("header.archived")}
              </span>
            ) : null}
          </span>
        </span>
        <span className={ISLAND}>
          <Button
            aria-label={t("header.back")}
            disabled={!canGoBack}
            onClick={goBack}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <Button
            aria-label={t("header.forward")}
            disabled={!canGoForward}
            onClick={goForward}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowRightIcon className="size-4" />
          </Button>
          <Button
            aria-label={t("header.exploreNewIdea")}
            disabled={
              isExploring ||
              !activeProjectId ||
              !activeTopicId ||
              !currentConversationId ||
              Boolean(activeTopic?.archivedAt)
            }
            onClick={() => setExploreOpen(true)}
            size="icon-sm"
            variant="ghost"
          >
            <SparklesIcon className="size-4" />
          </Button>
        </span>
      </div>

      <div className="-translate-x-1/2 absolute top-2.5 left-1/2">
        <div
          aria-label={t("header.workspaceView")}
          className={cn(ISLAND, "gap-1 p-1")}
          role="radiogroup"
        >
          {(["conversation", "truth-graph"] as const).map((value) => (
            <Button
              aria-checked={view === value}
              className={cn(
                "h-7 rounded-lg px-2.5 text-xs",
                view === value
                  ? "bg-[var(--ir-bg-hover)] text-[var(--ir-text-primary)]"
                  : "text-[var(--ir-text-tertiary)]"
              )}
              key={value}
              onClick={() => onViewChange(value)}
              role="radio"
              size="xs"
              variant="ghost"
            >
              {value === "conversation" ? (
                <MessagesSquareIcon className="size-3.5" />
              ) : (
                <NetworkIcon className="size-3.5" />
              )}
              {value === "conversation"
                ? t("view.conversation")
                : t("view.truthGraph")}
            </Button>
          ))}
        </div>
      </div>

      <div className="absolute top-2.5 right-3">
        <button
          className={cn(ISLAND, "px-3 text-xs text-[var(--ir-text-secondary)]")}
          data-testid="ir-drawer-trigger"
          onClick={onOpenDrawer}
          type="button"
        >
          {t("header.ideas")}&nbsp;
          <b className="font-medium text-[var(--ir-text-primary)]">
            {ideas.length}
          </b>
          <span className="mx-1.5 text-[var(--ir-text-tertiary)]">·</span>
          {t("header.candidates")}&nbsp;
          <b className="font-medium text-[var(--ir-text-primary)]">
            {candidates.length}
          </b>
        </button>
      </div>

      <AlertDialog onOpenChange={setExploreOpen} open={exploreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("header.exploreNewIdea")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("header.exploreDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isExploring}>
              {t("header.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isExploring}
              onClick={(event) => {
                event.preventDefault();
                handleExplore().catch(console.error);
              }}
            >
              {t("header.exploreConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
