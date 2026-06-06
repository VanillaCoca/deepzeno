"use client";

import {
  ArchiveIcon,
  ChevronsUpDownIcon,
  Layers3Icon,
  LogOutIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SparklesIcon,
  SunIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ProjectApiKeyDialog } from "@/components/project-api-key-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

function getTopicStatusLabel(status: string) {
  return status.replace("_", " ");
}

// ChatGPT-style account control: the user row is the trigger; the menu opens
// upward with a working light/dark toggle and Log out.
function SidebarAccountMenu({
  isSigningOut,
  onSignOut,
  userEmail,
}: {
  isSigningOut: boolean;
  onSignOut: () => void;
  userEmail: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : true;
  const email = userEmail ?? "Authenticated user";
  const name = email.includes("@") ? email.split("@")[0] : email;
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border/60 bg-sidebar px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent"
          type="button"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/10 text-xs font-semibold text-sidebar-primary ring-1 ring-sidebar-border/60">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-sidebar-foreground">
              {name}
            </span>
            <span className="block truncate text-xs text-sidebar-foreground/60">
              {email}
            </span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-sidebar-foreground/50" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="min-w-56"
        side="top"
        sideOffset={8}
      >
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            // Keep the menu open so the theme flip is visible while toggling.
            event.preventDefault();
            setTheme(isDark ? "light" : "dark");
          }}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
          {isDark ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isSigningOut}
          onSelect={() => onSignOut()}
          variant="destructive"
        >
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectSidebar({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const {
    activeProjectId,
    activeTopicId,
    createTopic,
    archiveTopic,
    isLoading,
    pendingCandidateCounts,
    projects,
    selectTopic,
    topics,
  } = useWorkspace();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [topicLabel, setTopicLabel] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);

  const activeTopics = useMemo(
    () => topics.filter((topic) => !topic.archivedAt),
    [topics]
  );
  const archivedTopics = useMemo(
    () => topics.filter((topic) => Boolean(topic.archivedAt)),
    [topics]
  );
  const activeProjectName =
    projects.find((project) => project.id === activeProjectId)?.name ?? null;

  async function handleSignOut() {
    if (!isSupabaseConfigured()) {
      router.push("/login");
      return;
    }

    setIsSigningOut(true);

    try {
      const supabase = createSupabaseClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  async function submitTopic() {
    const trimmed = topicLabel.trim();
    if (!trimmed) {
      return;
    }

    try {
      await createTopic(trimmed);
      setTopicLabel("");
      setTopicDialogOpen(false);
    } catch (error) {
      console.error(error);
      toast.error("Failed to create topic.");
    }
  }

  return (
    <>
      <Sidebar
        className="border-r border-sidebar-border/60"
        collapsible="offcanvas"
      >
        <SidebarHeader className="border-b border-sidebar-border/60 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <Link
              aria-label="Back to project selection"
              className="flex min-w-0 items-center gap-3 rounded-xl outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              href="/"
            >
              <div className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary/10 text-sidebar-primary ring-1 ring-sidebar-border/60">
                <SparklesIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-sidebar-foreground">
                  ZENO
                </p>
                <p className="truncate text-xs text-sidebar-foreground/60">
                  {activeProjectName ?? "Project selection"}
                </p>
              </div>
            </Link>
            <SidebarTrigger className="md:hidden" />
          </div>
        </SidebarHeader>

        <SidebarContent className="px-2 py-4">
          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/60">
              Judgments
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {activeTopics.map((topic) => {
                  const pendingCount = pendingCandidateCounts[topic.id] ?? 0;
                  const isActive = topic.id === activeTopicId;

                  return (
                    <SidebarMenuItem key={topic.id}>
                      <div className="flex items-center gap-2">
                        <SidebarMenuButton
                          className={cn(
                            "h-auto min-h-10 flex-1 rounded-xl border border-sidebar-border/60 bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent",
                            isActive &&
                              "bg-sidebar-accent text-sidebar-accent-foreground"
                          )}
                          data-topic-label={topic.label}
                          onClick={() => {
                            selectTopic(topic.id).catch(console.error);
                          }}
                        >
                          <Layers3Icon className="size-4" />
                          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                            <span className="truncate font-medium">
                              {topic.label}
                            </span>
                            <div className="flex items-center gap-2">
                              {pendingCount > 0 && (
                                <span className="rounded-full bg-sidebar-primary/15 px-2 py-0.5 text-[10px] font-semibold text-sidebar-primary">
                                  {pendingCount}
                                </span>
                              )}
                              {!topic.isGeneral && (
                                <span className="rounded-full border border-sidebar-border/60 px-2 py-0.5 text-[10px] capitalize text-sidebar-foreground/55">
                                  {getTopicStatusLabel(topic.status)}
                                </span>
                              )}
                              {topic.isGeneral && (
                                <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-sidebar-accent-foreground">
                                  General
                                </span>
                              )}
                            </div>
                          </div>
                        </SidebarMenuButton>

                        {!topic.isGeneral && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                aria-label={`More actions for ${topic.label}`}
                                className="h-9 rounded-xl px-2 text-sidebar-foreground/55 hover:text-sidebar-foreground"
                                size="sm"
                                variant="ghost"
                              >
                                <MoreHorizontalIcon className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" side="right">
                              <DropdownMenuItem
                                onSelect={() => {
                                  archiveTopic(topic.id).catch(console.error);
                                }}
                              >
                                <ArchiveIcon className="size-4" />
                                Archive
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>

              <Button
                className="mt-3 w-full justify-start rounded-xl"
                disabled={isLoading || !activeProjectId}
                onClick={() => setTopicDialogOpen(true)}
                size="sm"
                variant="outline"
              >
                <PlusIcon className="size-4" />
                New judgment
              </Button>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/60">
              Project context
            </SidebarGroupLabel>
            <SidebarGroupContent className="px-2">
              <ProjectApiKeyDialog
                disabled={isLoading}
                projectId={activeProjectId}
                projectName={activeProjectName}
              />
            </SidebarGroupContent>
          </SidebarGroup>

          {archivedTopics.length > 0 && (
            <SidebarGroup>
              <SidebarGroupContent className="px-2">
                <Button
                  className="h-8 w-full justify-start rounded-lg px-2 text-sidebar-foreground/50 hover:text-sidebar-foreground"
                  onClick={() => setArchivedOpen((current) => !current)}
                  size="sm"
                  variant="ghost"
                >
                  <ArchiveIcon className="size-3.5" />
                  Archived ({archivedTopics.length})
                </Button>
                {archivedOpen ? (
                  <SidebarMenu className="mt-1">
                    {archivedTopics.map((topic) => (
                      <SidebarMenuItem key={topic.id}>
                        <SidebarMenuButton
                          className={cn(
                            "h-auto rounded-xl border border-sidebar-border/50 bg-sidebar text-sidebar-foreground/65 hover:bg-sidebar-accent",
                            topic.id === activeTopicId &&
                              "bg-sidebar-accent text-sidebar-accent-foreground"
                          )}
                          data-topic-label={topic.label}
                          onClick={() => {
                            selectTopic(topic.id).catch(console.error);
                          }}
                        >
                          <ArchiveIcon className="size-4" />
                          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                            <span className="truncate font-medium">
                              {topic.label}
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/45">
                              Read only
                            </span>
                          </div>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                ) : null}
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/60 px-3 py-3">
          <SidebarAccountMenu
            isSigningOut={isSigningOut}
            onSignOut={handleSignOut}
            userEmail={userEmail}
          />
        </SidebarFooter>
      </Sidebar>

      <Dialog onOpenChange={setTopicDialogOpen} open={topicDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Judgment</DialogTitle>
            <DialogDescription>
              Start a blank judgment unit for a specific decision or question.
            </DialogDescription>
          </DialogHeader>
          <Input
            onChange={(event) => setTopicLabel(event.target.value)}
            placeholder="Judgment question"
            value={topicLabel}
          />
          <DialogFooter>
            <Button onClick={submitTopic}>
              <Layers3Icon className="size-4" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
