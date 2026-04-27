"use client";

import {
  ArchiveIcon,
  FolderKanbanIcon,
  Layers3Icon,
  LogOutIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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

export function ProjectSidebar({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const {
    activeProjectId,
    activeTopicId,
    createProject,
    createTopic,
    archiveTopic,
    isLoading,
    pendingCandidateCounts,
    projects,
    selectProject,
    selectTopic,
    topics,
  } = useWorkspace();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [topicLabel, setTopicLabel] = useState("");

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

  async function submitProject() {
    const trimmed = projectName.trim();
    if (!trimmed) {
      return;
    }

    try {
      await createProject(trimmed);
      setProjectName("");
      setProjectDialogOpen(false);
    } catch (error) {
      console.error(error);
      toast.error("Failed to create project.");
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
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary/10 text-sidebar-primary ring-1 ring-sidebar-border/60">
                <SparklesIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-sidebar-foreground">
                  Zeno
                </p>
                <p className="truncate text-xs text-sidebar-foreground/60">
                  Phase 2 Workspace
                </p>
              </div>
            </div>
            <SidebarTrigger className="md:hidden" />
          </div>
        </SidebarHeader>

        <SidebarContent className="px-2 py-4">
          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/60">
              Project
            </SidebarGroupLabel>
            <SidebarGroupContent className="px-2">
              <div className="space-y-2">
                <select
                  className="h-10 w-full rounded-xl border border-sidebar-border/60 bg-sidebar px-3 text-sm text-sidebar-foreground"
                  disabled={isLoading}
                  onChange={(event) => {
                    selectProject(event.target.value).catch(console.error);
                  }}
                  value={activeProjectId ?? ""}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <Button
                  className="w-full justify-start rounded-xl"
                  onClick={() => setProjectDialogOpen(true)}
                  size="sm"
                  variant="outline"
                >
                  <PlusIcon className="size-4" />
                  New Project
                </Button>
                <ProjectApiKeyDialog
                  disabled={isLoading}
                  projectId={activeProjectId}
                  projectName={activeProjectName}
                />
              </div>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/60">
              Topics
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
                              {topic.isGeneral && (
                                <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-sidebar-accent-foreground">
                                  General
                                </span>
                              )}
                            </div>
                          </div>
                        </SidebarMenuButton>

                        {!topic.isGeneral && (
                          <Button
                            className="h-9 rounded-xl px-2"
                            onClick={() => {
                              archiveTopic(topic.id).catch(console.error);
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            <ArchiveIcon className="size-4" />
                          </Button>
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
                New Topic
              </Button>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/60">
              Archived
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {archivedTopics.length === 0 ? (
                  <SidebarMenuItem>
                    <div className="rounded-xl border border-dashed border-sidebar-border/60 px-3 py-3 text-xs text-sidebar-foreground/60">
                      Archived topics will appear here.
                    </div>
                  </SidebarMenuItem>
                ) : (
                  archivedTopics.map((topic) => (
                    <SidebarMenuItem key={topic.id}>
                      <SidebarMenuButton
                        className={cn(
                          "h-auto rounded-xl border border-sidebar-border/60 bg-sidebar text-sidebar-foreground/75 hover:bg-sidebar-accent",
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
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/60 px-4 py-4">
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-sidebar-foreground">
                Signed in
              </p>
              <p className="truncate text-xs text-sidebar-foreground/60">
                {userEmail ?? "Authenticated user"}
              </p>
            </div>

            <Button
              className={cn(
                "justify-start rounded-xl",
                isSigningOut && "pointer-events-none opacity-70"
              )}
              onClick={handleSignOut}
              size="sm"
              variant="outline"
            >
              <LogOutIcon className="size-4" />
              Sign out
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <Dialog onOpenChange={setProjectDialogOpen} open={projectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>
              Each project gets its own General topic automatically.
            </DialogDescription>
          </DialogHeader>
          <Input
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Project name"
            value={projectName}
          />
          <DialogFooter>
            <Button onClick={submitProject}>
              <FolderKanbanIcon className="size-4" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setTopicDialogOpen} open={topicDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Topic</DialogTitle>
            <DialogDescription>
              General stays pinned on top. New topics open on their latest
              segment.
            </DialogDescription>
          </DialogHeader>
          <Input
            onChange={(event) => setTopicLabel(event.target.value)}
            placeholder="Topic label"
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
