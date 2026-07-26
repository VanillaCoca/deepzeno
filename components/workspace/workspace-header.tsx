"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  InboxIcon,
  Loader2Icon,
  MessagesSquareIcon,
  NetworkIcon,
  PanelLeftIcon,
  SparklesIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/components/i18n/locale-provider";
import { useIR } from "@/components/ir/ir-provider";
import { useInbox } from "@/components/ir/judgment-inbox";
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
import { ISLAND } from "@/components/workspace/island";
import {
  useWorkspace,
  type WorkspaceViewName,
} from "@/components/workspace/workspace-provider";
import { cn, fetchWithErrorHandlers } from "@/lib/utils";

/**
 * Re-exported under the name the stage components already import. The union
 * itself lives in the workspace provider so that `requestView` and this tab
 * strip can never drift apart — they did, and the inbox was unreachable from
 * anything but a click up here.
 */
export type WorkspaceView = WorkspaceViewName;

const VIEW_TABS: {
  value: WorkspaceView;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  labelKey: string;
}[] = [
  {
    value: "conversation",
    Icon: MessagesSquareIcon,
    labelKey: "view.conversation",
  },
  { value: "truth-graph", Icon: NetworkIcon, labelKey: "view.truthGraph" },
  { value: "inbox", Icon: InboxIcon, labelKey: "view.inbox" },
];

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
  const { ideas } = useIR();
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
    isActiveConversationEmpty,
  } = useWorkspace();
  const { data: inboxData } = useInbox(activeProjectId);
  const inboxCount = inboxData?.items?.length ?? 0;
  const [exploreOpen, setExploreOpen] = useState(false);
  const [isExploring, setIsExploring] = useState(false);

  async function handleExplore() {
    if (
      !(activeProjectId && activeTopicId && currentConversationId) ||
      isActiveConversationEmpty
    ) {
      return;
    }
    setIsExploring(true);
    try {
      // Awaited, and awaited *before* the conversation is cleared.
      //
      // This used to be fire-and-forget with `.catch(console.error)`, which was
      // fine while the route could only fail by malfunctioning. It is not fine
      // now that it can refuse: an exhausted allowance answers 402, and the old
      // shape swallowed it into the console, wiped the conversation off the
      // screen, and left the user believing their thinking had been extracted
      // when nothing had been. Iron Law 2's silent miss, in the one place the
      // user could least afford it.
      //
      // Awaiting costs one round trip and no more — the route is
      // accept-and-detach, so it answers as soon as the run row exists and the
      // sweep itself keeps going in its own tail.
      // `fetchWithErrorHandlers` is what turns the 402 into a sentence: it
      // reads the server's error code and rebuilds the user-facing message
      // client-side, so the catch below toasts "connect your own API key in
      // Settings" instead of a status number.
      await fetchWithErrorHandlers(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/sweep/manual`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: activeProjectId,
            chat_session_id: currentConversationId,
            blocking: false,
          }),
        }
      );

      await clearConversation();
      setExploreOpen(false);
    } catch (error) {
      // Surface the real reason instead of failing silently — clearConversation
      // throws the server's message (see postWorkspaceUpdate). Keep the dialog
      // open so the user can retry.
      console.error("Explore new idea failed", error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("header.exploreFailed")
      );
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
            className="h-8"
            disabled={
              isExploring ||
              !activeProjectId ||
              !activeTopicId ||
              !currentConversationId ||
              isActiveConversationEmpty ||
              Boolean(activeTopic?.archivedAt)
            }
            onClick={() => setExploreOpen(true)}
            size="xs"
            title={
              isActiveConversationEmpty
                ? t("header.exploreDisabledEmpty")
                : t("header.exploreHint")
            }
            variant="ghost"
          >
            <SparklesIcon className="size-4" />
            {t("header.newIdea")}
          </Button>
        </span>
      </div>

      <div className="-translate-x-1/2 absolute top-2.5 left-1/2">
        <div
          aria-label={t("header.workspaceView")}
          className={cn(ISLAND, "gap-1 p-1")}
          role="radiogroup"
        >
          {VIEW_TABS.map(({ value, Icon, labelKey }) => (
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
              <Icon className="size-3.5" />
              {t(labelKey)}
              {value === "inbox" && inboxCount > 0 ? (
                <span className="ml-0.5 rounded-full bg-[color-mix(in_srgb,var(--ir-accent-blue)_18%,transparent)] px-1 font-medium text-[10px] text-[var(--ir-accent-blue)]">
                  {inboxCount}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
      </div>

      {/* Ideas only. The candidate count used to sit beside it, which meant the
          same pending rows were counted twice on one screen — once here, once
          on the inbox tab — and the two numbers disagreed, because this one was
          topic-scoped and the badge is project-scoped. The badge won: it counts
          the rulings you owe. This one counts a pool that asks for nothing. */}
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
              {isExploring && <Loader2Icon className="size-4 animate-spin" />}
              {isExploring
                ? t("header.exploreProcessing")
                : t("header.exploreConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
