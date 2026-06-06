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
        <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
          <ProtectedWorkspace>{children}</ProtectedWorkspace>
        </Suspense>
      </DataStreamProvider>
    </>
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
