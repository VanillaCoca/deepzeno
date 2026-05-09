"use client";

import {
  ActivityIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  SquareKanbanIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { IRPanel } from "@/components/ir/ir-panel";
import { IRProvider } from "@/components/ir/ir-provider";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AgentActivityPanel } from "@/components/workspace/agent-activity-panel";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";
import { ProjectSidebar } from "./project-sidebar";

type RightPanelMode = "ir" | "agent-activity";
type StoredRightPanelMode = RightPanelMode | "truth";

const DEFAULT_RIGHT_PANEL_WIDTH = 540;
const MIN_RIGHT_PANEL_WIDTH = 440;
const MAX_RIGHT_PANEL_WIDTH = 720;

function clampRightPanelWidth(width: number) {
  return Math.min(
    MAX_RIGHT_PANEL_WIDTH,
    Math.max(MIN_RIGHT_PANEL_WIDTH, Math.round(width))
  );
}

export function WorkspaceShell({
  children,
  defaultSidebarOpen,
  userEmail,
}: {
  children: React.ReactNode;
  defaultSidebarOpen: boolean;
  userEmail: string | null;
}) {
  const [isRightPanelOpen, setIsRightPanelOpen] = useLocalStorage(
    "right-panel-open",
    true
  );
  const [rightPanelWidth, setRightPanelWidth] = useLocalStorage(
    "right-panel-width",
    DEFAULT_RIGHT_PANEL_WIDTH
  );
  const [rightPanelMode, setRightPanelMode] =
    useLocalStorage<StoredRightPanelMode>("right-panel-mode", "ir");
  const [hasMounted, setHasMounted] = useState(false);
  const { setSelectedDecisionId } = useWorkspace();
  const activeRightPanelMode: RightPanelMode =
    rightPanelMode === "agent-activity" ? "agent-activity" : "ir";

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (rightPanelMode === "truth") {
      setRightPanelMode("ir");
    }
  }, [rightPanelMode, setRightPanelMode]);

  const showRightPanel = hasMounted ? isRightPanelOpen : true;
  const panelWidth = hasMounted
    ? clampRightPanelWidth(rightPanelWidth)
    : DEFAULT_RIGHT_PANEL_WIDTH;

  useEffect(() => {
    if (hasMounted && rightPanelWidth !== panelWidth) {
      setRightPanelWidth(panelWidth);
    }
  }, [hasMounted, panelWidth, rightPanelWidth, setRightPanelWidth]);

  function handlePanelResizePointerDown(
    event: React.PointerEvent<HTMLButtonElement>
  ) {
    event.preventDefault();

    function handlePointerMove(pointerEvent: PointerEvent) {
      const nextWidth = window.innerWidth - pointerEvent.clientX;
      setRightPanelWidth(clampRightPanelWidth(nextWidth));
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function openRightPanel(mode: RightPanelMode) {
    setRightPanelMode(mode);
    setIsRightPanelOpen(true);
  }

  function handleViewDecision(decisionId: string) {
    setSelectedDecisionId(decisionId);
    openRightPanel("ir");
  }

  return (
    <SidebarProvider
      className="bg-sidebar"
      defaultOpen={defaultSidebarOpen}
      style={{ "--sidebar-width": "15rem" } as React.CSSProperties}
    >
      <ProjectSidebar userEmail={userEmail} />

      <SidebarInset className="min-h-dvh bg-sidebar">
        <IRProvider>
          <div className="relative flex h-dvh min-w-0">
            <div className="min-w-0 flex-1">{children}</div>

            <aside
              className={cn(
                "relative hidden h-dvh min-h-0 shrink-0 border-l border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] xl:flex xl:flex-col",
                !showRightPanel && "xl:hidden"
              )}
              data-testid="right-panel"
              style={{
                width: `${panelWidth}px`,
                minWidth: "var(--ir-right-panel-min-width)",
                maxWidth: `${MAX_RIGHT_PANEL_WIDTH}px`,
              }}
            >
              <button
                aria-label="Resize IR panel"
                className="absolute left-0 top-0 h-full w-1 -translate-x-1/2 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ir-border-focus)]"
                onPointerDown={handlePanelResizePointerDown}
                type="button"
              />
              <div className="flex items-center justify-between border-b border-[var(--ir-border-default)] px-4 py-3">
                <div className="min-w-0">
                  <div className="flex rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-subtle)] p-0.5">
                    <Button
                      aria-pressed={activeRightPanelMode === "ir"}
                      className={cn(
                        "h-7 rounded-md px-2 text-xs",
                        activeRightPanelMode === "ir"
                          ? "bg-[var(--ir-bg-panel)] text-[var(--ir-text-primary)]"
                          : "bg-transparent text-[var(--ir-text-tertiary)]"
                      )}
                      onClick={() => setRightPanelMode("ir")}
                      size="xs"
                      variant="ghost"
                    >
                      <SquareKanbanIcon className="size-3" />
                      IR Panel
                    </Button>
                    <Button
                      aria-pressed={activeRightPanelMode === "agent-activity"}
                      className={cn(
                        "h-7 rounded-md px-2 text-xs",
                        activeRightPanelMode === "agent-activity"
                          ? "bg-[var(--ir-bg-panel)] text-[var(--ir-text-primary)]"
                          : "bg-transparent text-[var(--ir-text-tertiary)]"
                      )}
                      onClick={() => setRightPanelMode("agent-activity")}
                      size="xs"
                      variant="ghost"
                    >
                      <ActivityIcon className="size-3" />
                      Agent Activity
                    </Button>
                  </div>
                </div>
                <Button
                  className="rounded border border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                  onClick={() => setIsRightPanelOpen(false)}
                  size="icon-sm"
                  variant="outline"
                >
                  <PanelRightCloseIcon className="size-4" />
                </Button>
              </div>

              {activeRightPanelMode === "agent-activity" ? (
                <AgentActivityPanel onViewDecision={handleViewDecision} />
              ) : (
                <IRPanel />
              )}
            </aside>

            {!showRightPanel && (
              <div className="absolute right-4 top-4 z-30 hidden gap-2 xl:flex">
                <Button
                  className="rounded border-[var(--ir-border-strong)] bg-[var(--ir-bg-panel)] hover:bg-[var(--ir-bg-hover)]"
                  onClick={() => openRightPanel("ir")}
                  size="sm"
                  variant="outline"
                >
                  <PanelRightOpenIcon className="size-4" />
                  IR Panel
                </Button>
                <Button
                  className="rounded border-[var(--ir-border-strong)] bg-[var(--ir-bg-panel)] hover:bg-[var(--ir-bg-hover)]"
                  onClick={() => openRightPanel("agent-activity")}
                  size="sm"
                  variant="outline"
                >
                  <ActivityIcon className="size-4" />
                  Agent Activity
                </Button>
              </div>
            )}
          </div>
        </IRProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
