"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  PanelLeftIcon,
  SparklesIcon,
} from "lucide-react";
import { memo, useState } from "react";
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
import type { VisibilityType } from "./visibility-selector";

function PureChatHeader({
  chatId: _chatId,
  selectedVisibilityType: _selectedVisibilityType,
  isReadonly,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
}) {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const {
    activeProjectId,
    activeTopic,
    activeTopicId,
    canGoBack,
    canGoForward,
    clearConversation,
    currentConversationId,
    goBack,
    goForward,
  } = useWorkspace();
  const [exploreDialogOpen, setExploreDialogOpen] = useState(false);
  const [isExploring, setIsExploring] = useState(false);

  if (state === "collapsed" && !isMobile) {
    return null;
  }

  async function handleExploreNewIdea() {
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
      setExploreDialogOpen(false);
    } finally {
      setIsExploring(false);
    }
  }

  return (
    <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3">
      <Button
        className="md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      {!isReadonly && (
        <div className="hidden items-center gap-1 md:flex">
          <Button
            disabled={!canGoBack}
            onClick={goBack}
            size="sm"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </Button>
          <Button
            disabled={!canGoForward}
            onClick={goForward}
            size="sm"
            variant="ghost"
          >
            <ArrowRightIcon className="size-4" />
            Forward
          </Button>
          <Button
            disabled={
              isExploring ||
              !activeProjectId ||
              !activeTopicId ||
              !currentConversationId ||
              Boolean(activeTopic?.archivedAt)
            }
            onClick={() => setExploreDialogOpen(true)}
            size="sm"
            variant="outline"
          >
            <SparklesIcon className="size-4" />
            {isExploring ? "Reviewing..." : "Explore new idea"}
          </Button>
        </div>
      )}

      <div className="ml-2 hidden min-w-0 md:block">
        <p className="truncate text-sm font-medium text-foreground">
          {activeTopic?.label ?? "Workspace"}
        </p>
        {activeTopic?.archivedAt ? (
          <p className="text-xs text-muted-foreground">Archived topic</p>
        ) : null}
      </div>
      <AlertDialog onOpenChange={setExploreDialogOpen} open={exploreDialogOpen}>
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
                handleExploreNewIdea().catch(console.error);
              }}
            >
              Yes, explore new
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly
  );
});
