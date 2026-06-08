import { Suspense } from "react";
import { requireAuth } from "@/app/(auth)/auth";
import { CreateProjectModal } from "@/components/create-project-modal";
import { ProjectCard } from "@/components/project-card";
import { Button } from "@/components/ui/button";
import { getHomeTranslator } from "@/lib/i18n/server";
import { listProjectSummariesByUserId } from "@/lib/workspace/queries";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";

function buildWorkspaceHref(project: WorkspaceProjectSummary) {
  const params = new URLSearchParams({
    projectId: project.id,
  });

  if (project.primaryTopicId) {
    params.set("topicId", project.primaryTopicId);
  }

  return `/chat/new?${params.toString()}`;
}

async function HomepageShell({ children }: { children: React.ReactNode }) {
  const t = await getHomeTranslator();

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-10">
        <div className="flex items-center justify-between gap-4">
          <span className="text-base font-medium">ZENO</span>
          <CreateProjectModal>
            <Button size="sm">+ {t("home.newProject")}</Button>
          </CreateProjectModal>
        </div>

        <h2 className="mb-3 mt-8 text-sm font-medium text-muted-foreground">
          {t("home.projects")}
        </h2>

        {children}
      </div>
    </main>
  );
}

function HomepageFallback() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((index) => (
        <div
          className="rounded-lg border border-border bg-background p-4"
          key={index}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          </div>
          <div className="mt-2 h-4 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

async function HomepageContent() {
  const session = await requireAuth();
  const projects = await listProjectSummariesByUserId(session.user.id);
  const t = await getHomeTranslator();

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24">
        <p className="text-sm text-muted-foreground">{t("home.empty")}</p>
        <CreateProjectModal>
          <Button>+ {t("home.newProject")}</Button>
        </CreateProjectModal>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {projects.map((project) => (
        <ProjectCard
          href={buildWorkspaceHref(project)}
          key={project.id}
          project={project}
        />
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <HomepageShell>
      <Suspense fallback={<HomepageFallback />}>
        <HomepageContent />
      </Suspense>
    </HomepageShell>
  );
}
