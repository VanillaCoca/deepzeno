import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireAuth } from "@/app/(auth)/auth";
import { Button } from "@/components/ui/button";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

function ProjectShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-10">
        {children}
      </div>
    </main>
  );
}

function ProjectFallback() {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <Button asChild size="sm" variant="ghost">
          <Link href="/">Back</Link>
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Inside-project view coming soon
        </p>
      </div>
    </>
  );
}

async function ProjectContent({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, requireAuth()]);
  const project = await getProjectByIdForUser(id, session.user.id);

  if (!project) {
    notFound();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <p className="text-base font-medium text-foreground">{project.name}</p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/chat/new?projectId=${project.id}`}>
              Open workspace
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/">Back</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          Inside-project view coming soon
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={`/chat/new?projectId=${project.id}`}>Open workspace</Link>
        </Button>
      </div>
    </>
  );
}

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <ProjectShell>
      <Suspense fallback={<ProjectFallback />}>
        <ProjectContent params={params} />
      </Suspense>
    </ProjectShell>
  );
}
