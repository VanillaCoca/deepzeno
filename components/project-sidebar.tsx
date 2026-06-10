"use client";

import {
  ArchiveIcon,
  ChevronsUpDownIcon,
  HashIcon,
  LanguagesIcon,
  LightbulbIcon,
  LockIcon,
  LogOutIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/components/i18n/locale-provider";
import { ProjectSearchDialog } from "@/components/project-search-dialog";
import { QuickNotesDialog } from "@/components/quick-notes-dialog";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { ZenoLogo } from "@/components/zeno-logo";
import { LOCALES, type Locale } from "@/lib/i18n/dictionaries";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
  const { locale, setLocale, t } = useLocale();

  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : true;
  const email = userEmail ?? "Authenticated user";
  const name = email.includes("@") ? email.split("@")[0] : email;
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border/60 bg-sidebar px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-2"
          title={name}
          type="button"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/10 text-xs font-semibold text-sidebar-primary ring-1 ring-sidebar-border/60">
            {initial}
          </span>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-medium text-sidebar-foreground">
              {name}
            </span>
            <span className="block truncate text-xs text-sidebar-foreground/60">
              {email}
            </span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
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
          {isDark ? t("account.lightMode") : t("account.darkMode")}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <LanguagesIcon />
            {t("account.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              onValueChange={(value) => setLocale(value as Locale)}
              value={locale}
            >
              {LOCALES.map((option) => (
                <DropdownMenuRadioItem key={option.code} value={option.code}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isSigningOut}
          onSelect={() => onSignOut()}
          variant="destructive"
        >
          <LogOutIcon />
          {t("account.logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectSidebar({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const {
    activeProjectId,
    activeTopicId,
    createTopic,
    archiveTopic,
    isLoading,
    pendingCandidateCounts,
    projects,
    renameProject,
    renameTopic,
    selectTopic,
    topics,
  } = useWorkspace();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [topicLabel, setTopicLabel] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<
    { kind: "topic"; id: string } | { kind: "project"; id: string } | null
  >(null);
  const [renameDraft, setRenameDraft] = useState("");

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

  async function submitRename() {
    const trimmed = renameDraft.trim();
    if (!(renameTarget && trimmed)) {
      return;
    }

    try {
      if (renameTarget.kind === "topic") {
        await renameTopic(renameTarget.id, trimmed);
      } else {
        await renameProject(renameTarget.id, trimmed);
      }
      setRenameTarget(null);
      setRenameDraft("");
    } catch (error) {
      console.error(error);
      toast.error(t("rename.failed"));
    }
  }

  return (
    <>
      <Sidebar className="border-r border-sidebar-border/60" collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border/60 px-4 py-4 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3">
          <div className="flex items-center justify-between gap-2">
            {/* Brand: links to the library when expanded; in the collapsed rail
                it becomes a hover-to-expand control (ChatGPT-style). */}
            <div className="group/brand relative flex size-8 items-center justify-center">
              <Link
                aria-label="Back to library"
                className="rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:group-hover/brand:opacity-0"
                href="/"
              >
                <ZenoLogo className="size-7 text-sidebar-foreground" />
              </Link>
              {/* Expand control — only present in the collapsed rail, on hover. */}
              <SidebarTrigger
                aria-label="Expand sidebar"
                className="absolute inset-0 hidden size-8 opacity-0 transition-opacity group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:group-hover/brand:opacity-100"
              />
            </div>
            {/* Collapse / mobile-close control — hidden once collapsed. */}
            <SidebarTrigger
              aria-label="Collapse sidebar"
              className="group-data-[collapsible=icon]:hidden"
            />
          </div>
          {/* Project title shows in full (wraps) — never truncated. */}
          <div className="group/title mt-3 flex items-start gap-1.5 group-data-[collapsible=icon]:hidden">
            <p className="break-words font-semibold text-[15px] leading-snug text-sidebar-foreground">
              {activeProjectName ?? t("nav.projectSelection")}
            </p>
            {activeProjectId ? (
              <button
                aria-label={t("rename.projectTitle")}
                className="mt-1 shrink-0 text-sidebar-foreground/40 opacity-0 transition-opacity hover:text-sidebar-foreground focus-visible:opacity-100 group-hover/title:opacity-100"
                onClick={() => {
                  setRenameTarget({ kind: "project", id: activeProjectId });
                  setRenameDraft(activeProjectName ?? "");
                }}
                type="button"
              >
                <PencilIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
        </SidebarHeader>

        <SidebarContent className="gap-0 px-2 py-3">
          {/* Project utilities — stay visible (as icons) in the collapsed rail */}
          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem>
              <button
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
                onClick={() => setSearchOpen(true)}
                title={t("nav.search")}
                type="button"
              >
                <SearchIcon className="size-4 shrink-0 opacity-70" />
                <span className="group-data-[collapsible=icon]:hidden">
                  {t("nav.search")}
                </span>
              </button>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <button
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!activeProjectId}
                onClick={() => setNotesOpen(true)}
                title={t("nav.quickNotes")}
                type="button"
              >
                <LightbulbIcon className="size-4 shrink-0 opacity-70" />
                <span className="group-data-[collapsible=icon]:hidden">
                  {t("nav.quickNotes")}
                </span>
              </button>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="my-2.5 h-px bg-sidebar-border/60 group-data-[collapsible=icon]:hidden" />

          <SidebarGroup className="p-0 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">
              {t("nav.topics")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {activeTopics.map((topic) => {
                  const pendingCount = pendingCandidateCounts[topic.id] ?? 0;
                  const isActive = topic.id === activeTopicId;

                  return (
                    <SidebarMenuItem
                      className="group/topic relative"
                      key={topic.id}
                    >
                      <button
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg py-2 pr-8 pl-2.5 text-left text-[13px] transition-colors",
                          isActive
                            ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent"
                        )}
                        data-topic-label={topic.label}
                        onClick={() => {
                          selectTopic(topic.id).catch(console.error);
                        }}
                        type="button"
                      >
                        {topic.isGeneral ? (
                          <LockIcon className="size-4 shrink-0 opacity-70" />
                        ) : (
                          <HashIcon className="size-4 shrink-0 opacity-60" />
                        )}
                        {/* Full topic name — wraps, never truncated. */}
                        <span className="min-w-0 flex-1 break-words">
                          {topic.label}
                        </span>
                        {pendingCount > 0 && (
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 text-[10px] font-semibold transition-opacity group-hover/topic:opacity-0",
                              isActive
                                ? "bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground"
                                : "bg-sidebar-accent text-sidebar-foreground/70"
                            )}
                          >
                            {pendingCount}
                          </span>
                        )}
                      </button>

                      {!topic.isGeneral && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-label={`More actions for ${topic.label}`}
                              className={cn(
                                "-translate-y-1/2 absolute top-1/2 right-1 size-7 px-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/topic:opacity-100",
                                isActive
                                  ? "text-sidebar-primary-foreground hover:bg-sidebar-primary-foreground/15"
                                  : "text-sidebar-foreground/55 hover:text-sidebar-foreground"
                              )}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <MoreHorizontalIcon className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="right">
                            <DropdownMenuItem
                              onSelect={() => {
                                setRenameTarget({
                                  kind: "topic",
                                  id: topic.id,
                                });
                                setRenameDraft(topic.label);
                              }}
                            >
                              <PencilIcon className="size-4" />
                              {t("rename.menu")}
                            </DropdownMenuItem>
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
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>

              <button
                className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading || !activeProjectId}
                onClick={() => setTopicDialogOpen(true)}
                type="button"
              >
                <PlusIcon className="size-4 shrink-0" />
                {t("nav.newTopic")}
              </button>
            </SidebarGroupContent>
          </SidebarGroup>

          {archivedTopics.length > 0 && (
            <SidebarGroup className="group-data-[collapsible=icon]:hidden">
              <SidebarGroupContent className="px-2">
                <Button
                  className="h-8 w-full justify-start rounded-lg px-2 text-sidebar-foreground/50 hover:text-sidebar-foreground"
                  onClick={() => setArchivedOpen((current) => !current)}
                  size="sm"
                  variant="ghost"
                >
                  <ArchiveIcon className="size-3.5" />
                  {t("nav.archived")} ({archivedTopics.length})
                </Button>
                {archivedOpen ? (
                  <SidebarMenu className="mt-0.5 gap-0.5">
                    {archivedTopics.map((topic) => (
                      <SidebarMenuItem key={topic.id}>
                        <button
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                            topic.id === activeTopicId
                              ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
                              : "text-sidebar-foreground/65 hover:bg-sidebar-accent"
                          )}
                          data-topic-label={topic.label}
                          onClick={() => {
                            selectTopic(topic.id).catch(console.error);
                          }}
                          type="button"
                        >
                          <ArchiveIcon className="size-4 shrink-0 opacity-60" />
                          <span className="min-w-0 flex-1 break-words">
                            {topic.label}
                          </span>
                        </button>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                ) : null}
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/60 px-3 py-3 group-data-[collapsible=icon]:px-0">
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
            <DialogTitle>{t("dialog.sidebar.newTopicTitle")}</DialogTitle>
            <DialogDescription>
              {t("dialog.sidebar.newTopicDescription")}
            </DialogDescription>
          </DialogHeader>
          <Input
            onChange={(event) => setTopicLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitTopic();
              }
            }}
            placeholder={t("dialog.sidebar.newTopicPlaceholder")}
            value={topicLabel}
          />
          <DialogFooter>
            <Button onClick={submitTopic}>
              <PlusIcon className="size-4" />
              {t("dialog.sidebar.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProjectSearchDialog onOpenChange={setSearchOpen} open={searchOpen} />
      <QuickNotesDialog onOpenChange={setNotesOpen} open={notesOpen} />

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setRenameTarget(null);
            setRenameDraft("");
          }
        }}
        open={Boolean(renameTarget)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {renameTarget?.kind === "project"
                ? t("rename.projectTitle")
                : t("rename.topicTitle")}
            </DialogTitle>
          </DialogHeader>
          <Input
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitRename();
              }
            }}
            placeholder={
              renameTarget?.kind === "project"
                ? t("rename.projectPlaceholder")
                : t("rename.topicPlaceholder")
            }
            value={renameDraft}
          />
          <DialogFooter>
            <Button disabled={!renameDraft.trim()} onClick={submitRename}>
              {t("rename.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
