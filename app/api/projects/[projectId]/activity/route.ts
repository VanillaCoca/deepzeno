import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { listProjectRunActivity } from "@/lib/research/queries";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

/**
 * Every long agent run in this project that is either in flight or recent
 * enough to still be worth reporting.
 *
 * This is polled while work is running, so it does exactly one query and does
 * no work the caller could do itself: the phase rail, the elapsed time and the
 * staleness verdict are all derived on the client from
 * lib/research/run-progress-core.ts. Sending a pre-rendered "62%" from here
 * would be a number computed at a moment that has already passed by the time
 * it is drawn.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { projectId } = await context.params;
    const project = await getProjectByIdForUser(projectId, session.user.id);

    if (!project) {
      return new ChatbotError(
        "not_found:chat",
        "Project not found"
      ).toResponse();
    }

    const url = new URL(request.url);
    const since = url.searchParams.get("since");

    const runs = await listProjectRunActivity({
      projectId,
      // `since` bounds the *finished* runs only. Anything still active comes
      // back regardless of age — a run that has been going for six hours is
      // precisely the one the user most needs to see.
      sinceIso: since ?? undefined,
    });

    return Response.json({
      runs,
      // The server's clock, so the client can measure elapsed time against the
      // same reference the rows were written with. A device whose clock is
      // three minutes fast would otherwise report every fresh run as stale.
      now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Load project run activity failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
