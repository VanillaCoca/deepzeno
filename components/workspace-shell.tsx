"use client";

import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { IRDrawer } from "@/components/ir/ir-drawer";
import { IRProvider, useIR } from "@/components/ir/ir-provider";
import { TruthGraphStage } from "@/components/ir/truth-graph-stage";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
  WorkspaceToolbar,
  type WorkspaceView,
} from "@/components/workspace/workspace-toolbar";
import { ProjectSidebar } from "./project-sidebar";

function ViewToolbar(props: {
  onOpenDrawer: () => void;
  onViewChange: (view: WorkspaceView) => void;
  view: WorkspaceView;
}) {
  const { candidates, ideas } = useIR();
  return (
    <WorkspaceToolbar
      candidateCount={candidates.length}
      ideaCount={ideas.length}
      onOpenDrawer={props.onOpenDrawer}
      onViewChange={props.onViewChange}
      view={props.view}
    />
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
  const [view, setView] = useLocalStorage<WorkspaceView>(
    "workspace-view",
    "conversation"
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

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
            <div className="flex min-w-0 flex-1 flex-col">
              <ViewToolbar
                onOpenDrawer={() => setDrawerOpen(true)}
                onViewChange={setView}
                view={view}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                {view === "truth-graph" ? <TruthGraphStage /> : children}
              </div>
            </div>
          </div>

          <IRDrawer onClose={() => setDrawerOpen(false)} open={drawerOpen} />
        </IRProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
