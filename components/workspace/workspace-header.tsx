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
  "pointer-events-auto inline-flex h-9 items-center gap-1 rounded-xl border border-[var(--ir-border-default)] bg-[color-mix(in_srgb,var(--ir-bg-panel)_72%,transparent)] px-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.28)] backdrop-blur-md";

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
          <Button
            aria-label="Toggle sidebar"
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
            {activeTopic?.label ?? "Workspace"}
          </span>
        </span>
        <span className={ISLAND}>
          <Button
            aria-label="Back"
            disabled={!canGoBack}
            onClick={goBack}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <Button
            aria-label="Forward"
            disabled={!canGoForward}
            onClick={goForward}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowRightIcon className="size-4" />
          </Button>
          <Button
            aria-label="Explore new idea"
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
          aria-label="Workspace view"
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
              {value === "conversation" ? "Conversation" : "Truth Graph"}
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
          Ideas&nbsp;
          <b className="font-medium text-[var(--ir-text-primary)]">
            {ideas.length}
          </b>
          <span className="mx-1.5 text-[var(--ir-text-tertiary)]">·</span>
          Candidates&nbsp;
          <b className="font-medium text-[var(--ir-text-primary)]">
            {candidates.length}
          </b>
        </button>
      </div>

      <AlertDialog onOpenChange={setExploreOpen} open={exploreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Explore new idea</AlertDialogTitle>
            <AlertDialogDescription>
              Start fresh on a new idea in this topic? ZENO will review the
              current discussion before clearing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isExploring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isExploring}
              onClick={(event) => {
                event.preventDefault();
                handleExplore().catch(console.error);
              }}
            >
              Yes, explore new
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
