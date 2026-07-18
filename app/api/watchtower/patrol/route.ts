import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { runPatrolForWatch } from "@/lib/research/patrol";
import { getWatchById } from "@/lib/research/watch-queries";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

// "Patrol now" — the settings popover / Monitoring section trigger, and the
// local test entry point. One watch per request, same engine as the cron.
export const maxDuration = 300;

const bodySchema = z.object({ watch_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = bodySchema.parse(await request.json());
    const watch = await getWatchById(body.watch_id);
    if (!watch) {
      return new ChatbotError("not_found:chat", "Watch not found").toResponse();
    }
    const project = await getProjectByIdForUser(
      watch.projectId,
      session.user.id
    );
    if (!project) {
      return new ChatbotError(
        "not_found:chat",
        "Project not found"
      ).toResponse();
    }

    const result = await runPatrolForWatch({ watchId: watch.id });
    return Response.json({ result });
  } catch (error) {
    return irErrorToResponse(error, "Patrol failed");
  }
}
