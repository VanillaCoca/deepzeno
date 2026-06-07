"use client";

import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { IRDrawer } from "@/components/ir/ir-drawer";
import { IRProvider, useIR } from "@/components/ir/ir-provider";
import { TruthGraphStage } from "@/components/ir/truth-graph-stage";
import { LoadingOverlay } from "@/components/loading-overlay";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
  WorkspaceHeader,
  type WorkspaceView,
} from "@/components/workspace/workspace-header";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { ProjectSidebar } from "./project-sidebar";

/**
 * Keeps the frosted veil up until the workspace is genuinely usable: both the
 * workspace bootstrap (projects/judgments) AND the IR data (the truth graph)
 * must be loaded before the user can interact.
 */
function WorkspaceReadyVeil() {
  const { isLoading: workspaceLoading, sandboxNavPending } = useWorkspace();
  const { isLoading: irLoading } = useIR();

  if (sandboxNavPending) {
    return (
      <LoadingOverlay
        message="Opening the conversation"
        show
        submessage="Bringing your decision into the chat"
      />
    );
  }

  if (workspaceLoading) {
    return (
      <LoadingOverlay
        message="Preparing your workspace"
        show
        submessage="Fetching your projects and judgments"
      />
    );
  }

  if (irLoading) {
    return (
      <LoadingOverlay
        message="Loading the truth graph"
        show
        submessage="Gathering truths, candidates, and ideas"
      />
    );
  }

  return null;
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
  const { viewRequest, sandboxNavPending, endSandboxNav } = useWorkspace();

  // The server can't read localStorage, so it always renders the default view.
  // Reflect the stored view only AFTER mount, so the first client render matches
  // the server HTML and React doesn't report a hydration mismatch.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const activeView: WorkspaceView = hydrated ? view : "conversation";

  // A deep component (e.g. the IR action column) can request a view switch.
  useEffect(() => {
    if (viewRequest) {
      setView(viewRequest.view);
    }
  }, [viewRequest, setView]);

  // Safety net: never let the sandbox veil get stuck if the conversation never
  // signals "ready" (e.g. no chat mounted). The chat clears it sooner.
  useEffect(() => {
    if (!sandboxNavPending) {
      return;
    }
    const timer = setTimeout(() => endSandboxNav(), 4000);
    return () => clearTimeout(timer);
  }, [sandboxNavPending, endSandboxNav]);

  return (
    <SidebarProvider
      className="bg-sidebar"
      defaultOpen={defaultSidebarOpen}
      style={{ "--sidebar-width": "16.5rem" } as React.CSSProperties}
    >
      <ProjectSidebar userEmail={userEmail} />

      <SidebarInset className="min-h-dvh bg-sidebar">
        <IRProvider>
          <WorkspaceReadyVeil />
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
