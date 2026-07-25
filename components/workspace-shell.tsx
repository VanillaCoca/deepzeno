"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { IRDrawer } from "@/components/ir/ir-drawer";
import { IRProvider, useIR } from "@/components/ir/ir-provider";
import { JudgmentInbox } from "@/components/ir/judgment-inbox";
import { TruthGraphStage } from "@/components/ir/truth-graph-stage";
import { LoadingOverlay } from "@/components/loading-overlay";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ChangeBar } from "@/components/workspace/change-bar";
import {
  WorkspaceHeader,
  type WorkspaceView,
} from "@/components/workspace/workspace-header";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { ProjectSidebar } from "./project-sidebar";

function isWorkspaceView(value: string | null): value is WorkspaceView {
  return (
    value === "conversation" || value === "truth-graph" || value === "inbox"
  );
}

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [view, setView] = useLocalStorage<WorkspaceView>(
    "workspace-view",
    "conversation"
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { viewRequest, sandboxNavPending, endSandboxNav } = useWorkspace();

  // The server can't read localStorage, so it always renders the default view.
  // Reflect the stored/URL view only AFTER mount, so the first client render
  // matches the server HTML and React doesn't report a hydration mismatch.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  // The URL (?view=) is the source of truth once hydrated — that's what makes
  // the inbox addressable and deep-linkable; localStorage is the fallback so a
  // returning user lands where they left off.
  const urlView = searchParams.get("view");
  let activeView: WorkspaceView = "conversation";
  if (hydrated) {
    activeView = isWorkspaceView(urlView) ? urlView : view;
  }

  function applyView(next: WorkspaceView) {
    setView(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "conversation") {
      params.delete("view");
    } else {
      params.set("view", next);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  // A deep component (e.g. the IR action column) can request a view switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: react only to a new
  // viewRequest; depending on searchParams/router would re-fire on our own URL
  // writes and loop.
  useEffect(() => {
    if (!viewRequest) {
      return;
    }
    setView(viewRequest.view);
    const params = new URLSearchParams(searchParams.toString());
    if (viewRequest.view === "conversation") {
      params.delete("view");
    } else {
      params.set("view", viewRequest.view);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [viewRequest]);

  // Safety net: never let the sandbox veil get stuck if the conversation never
  // signals "ready" (e.g. no chat mounted). The chat clears it sooner.
  useEffect(() => {
    if (!sandboxNavPending) {
      return;
    }
    const timer = setTimeout(() => endSandboxNav(), 4000);
    return () => clearTimeout(timer);
  }, [sandboxNavPending, endSandboxNav]);

  function renderStage() {
    if (activeView === "truth-graph") {
      return <TruthGraphStage />;
    }
    if (activeView === "inbox") {
      return <JudgmentInbox />;
    }
    return children;
  }

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
                onOpenDrawer={() => setDrawerOpen((current) => !current)}
                onViewChange={applyView}
                view={activeView}
              />
              {/* Directly under the header, on the surface the user actually
                  lands on: a change report the user has to go looking for is
                  only useful to someone who already suspects a change. */}
              <ChangeBar onGoTo={applyView} />
              <div className="min-h-0 flex-1 overflow-hidden">
                {renderStage()}
              </div>
            </div>
          </div>

          <IRDrawer onClose={() => setDrawerOpen(false)} open={drawerOpen} />
        </IRProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
