"use client";

import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { IRDrawer } from "@/components/ir/ir-drawer";
import { IRProvider } from "@/components/ir/ir-provider";
import { TruthGraphStage } from "@/components/ir/truth-graph-stage";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
  WorkspaceHeader,
  type WorkspaceView,
} from "@/components/workspace/workspace-header";
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
  const [view, setView] = useLocalStorage<WorkspaceView>(
    "workspace-view",
    "conversation"
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The server can't read localStorage, so it always renders the default view.
  // Reflect the stored view only AFTER mount, so the first client render matches
  // the server HTML and React doesn't report a hydration mismatch.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const activeView: WorkspaceView = hydrated ? view : "conversation";

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
            <div className="relative flex min-w-0 flex-1 flex-col">
              <WorkspaceHeader
                onOpenDrawer={() => setDrawerOpen(true)}
                onViewChange={setView}
                view={activeView}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                {activeView === "truth-graph" ? <TruthGraphStage /> : children}
              </div>
            </div>
          </div>

          <IRDrawer
            onClose={() => setDrawerOpen(false)}
            onNavigateToTruth={() => {
              setView("truth-graph");
              setDrawerOpen(false);
            }}
            open={drawerOpen}
          />
        </IRProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
