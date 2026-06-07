import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Script from "next/script";
import { Suspense } from "react";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { ChatShell } from "@/components/chat/shell";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
import { auth } from "../(auth)/auth";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="lazyOnload"
      />
      <DataStreamProvider>
        <Suspense fallback={<WorkspaceBootFallback />}>
          <ProtectedWorkspace>{children}</ProtectedWorkspace>
        </Suspense>
      </DataStreamProvider>
    </>
  );
}

// Shown while the workspace route boots (auth + cookies) on navigation from the
// project picker — the same "thinking" shimmer the in-workspace veil uses, so
// the hand-off reads as one continuous loading experience.
function WorkspaceBootFallback() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-2.5 bg-background">
      <p className="z-shimmer-text text-base font-medium tracking-tight">
        Preparing your workspace
      </p>
      <p className="text-xs text-muted-foreground/70">
        Loading your projects and judgments
      </p>
    </div>
  );
}

async function ProtectedWorkspace({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const isSidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <WorkspaceProvider>
      <WorkspaceShell
        defaultSidebarOpen={isSidebarOpen}
        userEmail={session.user.email}
      >
        <ActiveChatProvider>
          <ChatShell />
        </ActiveChatProvider>
        {children}
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
