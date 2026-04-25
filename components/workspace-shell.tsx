"use client";

import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ProjectSidebar } from "./project-sidebar";

export function WorkspaceShell({
  children,
  defaultSidebarOpen,
  userEmail,
}: {
  children: React.ReactNode;
  defaultSidebarOpen: boolean;
  userEmail: string | null;
}) {
  const [isTruthPanelOpen, setIsTruthPanelOpen] = useLocalStorage(
    "truth-panel-open",
    true
  );
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const showTruthPanel = hasMounted ? isTruthPanelOpen : true;

  return (
    <SidebarProvider
      className="bg-sidebar"
      defaultOpen={defaultSidebarOpen}
      style={{ "--sidebar-width": "15rem" } as React.CSSProperties}
    >
      <ProjectSidebar userEmail={userEmail} />

      <SidebarInset className="min-h-dvh bg-sidebar">
        <div className="relative flex h-dvh min-w-0">
          <div className="min-w-0 flex-1">{children}</div>

          <aside
            className={cn(
              "hidden h-dvh w-[360px] shrink-0 border-l border-border/40 bg-muted/35 xl:flex xl:flex-col",
              !showTruthPanel && "xl:hidden"
            )}
          >
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Truth Panel
                </p>
                <p className="text-xs text-muted-foreground">Phase 2</p>
              </div>
              <Button
                onClick={() => setIsTruthPanelOpen(false)}
                size="icon-sm"
                variant="ghost"
              >
                <PanelRightCloseIcon className="size-4" />
              </Button>
            </div>

            <div className="flex flex-1 flex-col gap-4 p-4">
              <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-background/70 px-6 text-center text-sm text-muted-foreground">
                Truth Panel — Phase 2
              </div>
            </div>
          </aside>

          {!showTruthPanel && (
            <Button
              className="absolute right-4 top-4 z-30 hidden xl:inline-flex"
              onClick={() => setIsTruthPanelOpen(true)}
              size="sm"
              variant="outline"
            >
              <PanelRightOpenIcon className="size-4" />
              Truth Panel
            </Button>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
