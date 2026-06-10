import { PlusIcon } from "lucide-react";
import { Suspense } from "react";
import { requireAuth } from "@/app/(auth)/auth";
import { DeferredCreateProject } from "@/components/home/deferred-create-project";
import { HomeGreeting } from "@/components/home/home-greeting";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { ProjectCard } from "@/components/project-card";
import { Button } from "@/components/ui/button";
import { ZenoLogo } from "@/components/zeno-logo";
import { getHomeTranslator } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { listProjectSummariesByUserId } from "@/lib/workspace/queries";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";

const AVERIA = { fontFamily: "var(--font-averia)" } as const;

// Brand lockup = the carved profile mark (reused from the sidebar) next to the
// Averia wordmark, icon-left like the reference. "header" is the quiet top-left
// chrome; "hero" is the elevated empty-state mark.
function BrandLockup({ size = "header" }: { size?: "header" | "hero" }) {
  const isHero = size === "hero";
  return (
    <div className={cn("flex items-center", isHero ? "gap-3" : "gap-2")}>
      <ZenoLogo
        className={cn("text-foreground", isHero ? "size-11" : "size-7")}
      />
      <span
        className={cn(
          "text-foreground tracking-tight",
          isHero ? "text-5xl" : "text-xl"
        )}
        style={AVERIA}
      >
        ZENO
      </span>
    </div>
  );
}

function buildWorkspaceHref(project: WorkspaceProjectSummary) {
  const params = new URLSearchParams({
    projectId: project.id,
  });

  if (project.primaryTopicId) {
    params.set("topicId", project.primaryTopicId);
  }

  return `/chat/new?${params.toString()}`;
}

function nameFromEmail(email: string | null | undefined) {
  if (!email) {
    return "there";
  }
  const handle = email.includes("@") ? email.split("@")[0] : email;
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}

async function HomepageShell({ children }: { children: React.ReactNode }) {
  const t = await getHomeTranslator();

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-8 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <BrandLockup />
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <DeferredCreateProject>
              <Button size="sm">
                <PlusIcon className="size-4" />
                {t("home.newProject")}
              </Button>
            </DeferredCreateProject>
          </div>
        </header>

        {children}
      </div>
    </main>
  );
}

function ProjectGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4].map((index) => (
        <div
          className="h-[7.5rem] rounded-2xl border border-border/60 bg-card/30"
          key={index}
        >
          <div className="flex items-start justify-between p-4">
            <div className="size-9 animate-pulse rounded-xl bg-muted" />
            <div className="h-3 w-14 animate-pulse rounded bg-muted" />
          </div>
          <div className="px-4">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Body skeleton: a faint greeting placeholder plus the card grid skeleton.
function HomepageBodyFallback() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="py-10">
        <div className="h-9 w-72 animate-pulse rounded-lg bg-muted" />
        <div className="mt-3 h-4 w-24 animate-pulse rounded bg-muted" />
      </div>
      <ProjectGridSkeleton />
    </div>
  );
}

// Frame skeleton for the brief moment the locale cookie resolves; "ZENO" is
// brand text and needs no locale.
function HomepageFrameFallback() {
  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-8 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <BrandLockup />
          <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        </header>
        <HomepageBodyFallback />
      </div>
    </main>
  );
}

function EmptyState({
  t,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-20 text-center">
      <BrandLockup size="hero" />
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="font-medium text-foreground text-lg">
          {t("home.emptyTitle")}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("home.emptyBody")}
        </p>
      </div>
      <DeferredCreateProject>
        <Button>
          <PlusIcon className="size-4" />
          {t("home.newProject")}
        </Button>
      </DeferredCreateProject>
    </div>
  );
}

async function HomepageContent() {
  const session = await requireAuth();
  const projects = await listProjectSummariesByUserId(session.user.id);
  const t = await getHomeTranslator();

  if (projects.length === 0) {
    return <EmptyState t={t} />;
  }

  const countLabel =
    projects.length === 1
      ? t("home.projectCountOne")
      : t("home.projectCountOther", { count: projects.length });

  return (
    <div className="flex flex-1 flex-col">
      <div className="py-10">
        <HomeGreeting
          greetings={{
            morning: t("home.greetingMorning"),
            afternoon: t("home.greetingAfternoon"),
            evening: t("home.greetingEvening"),
          }}
          name={nameFromEmail(session.user.email)}
        />
        <p className="mt-2 text-muted-foreground text-sm">{countLabel}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Wrapped in a div so every grid child is a <div> like ProjectCard.
            DeferredCreateProject mounts the Radix modal after hydration to dodge
            the PPR-streaming useId mismatch (see that component). */}
        <div className="min-h-[7.5rem]">
          <DeferredCreateProject>
            <Button
              className="h-auto min-h-[7.5rem] w-full cursor-pointer flex-col gap-2 rounded-2xl border border-border/70 border-dashed bg-transparent text-muted-foreground shadow-none transition-colors hover:border-foreground/30 hover:bg-card/40 hover:text-foreground"
              type="button"
              variant="outline"
            >
              <PlusIcon className="size-5" />
              <span className="font-medium text-sm">
                {t("home.newProject")}
              </span>
            </Button>
          </DeferredCreateProject>
        </div>

        {projects.map((project) => (
          <ProjectCard
            href={buildWorkspaceHref(project)}
            key={project.id}
            project={project}
          />
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<HomepageFrameFallback />}>
      <HomepageShell>
        <Suspense fallback={<HomepageBodyFallback />}>
          <HomepageContent />
        </Suspense>
      </HomepageShell>
    </Suspense>
  );
}
