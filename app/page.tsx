import { formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { Suspense } from "react";
import { requireAuth } from "@/app/(auth)/auth";
import { CreateProjectModal } from "@/components/create-project-modal";
import { Button } from "@/components/ui/button";
import { listProjectSummariesByUserId } from "@/lib/workspace/queries";

function HomepageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-10">
        <div className="flex items-center justify-between gap-4">
          <span className="text-base font-medium">Zeno</span>
          <CreateProjectModal>
            <Button size="sm">+ New project</Button>
          </CreateProjectModal>
        </div>

        <h2 className="mb-3 mt-8 text-sm font-medium text-muted-foreground">
          Projects
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

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24">
        <p className="text-sm text-muted-foreground">
          You haven't started any projects yet.
        </p>
        <CreateProjectModal>
          <Button>+ New project</Button>
        </CreateProjectModal>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {projects.map((project) => (
        <Link
          className="cursor-pointer rounded-lg border border-border bg-background p-4 transition-colors hover:bg-muted/30"
          href={`/chat/new?projectId=${project.id}`}
          key={project.id}
        >
          <div className="flex items-start justify-between gap-4">
            <p className="text-base font-medium text-foreground">
              {project.name}
            </p>
            <p className="text-right text-sm text-muted-foreground">
              {formatDistanceToNowStrict(new Date(project.updatedAt), {
                addSuffix: true,
              })}
            </p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {project.topicCount} {project.topicCount === 1 ? "topic" : "topics"}
          </p>
        </Link>
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
