import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { requestRunCancellation } from "@/lib/research/queries";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

const bodySchema = z.object({ project_id: z.string().uuid() });

/**
 * Ask a run to stop.
 *
 * This flips the row to `cancelling` and returns. It does not kill anything:
 * the run itself reads its own status at every checkpoint and raises when it
 * sees this, which is why cancelling is honoured partway through collection
 * rather than only at a phase boundary. Worst case the user waits out one
 * in-flight fetch.
 *
 * The two-step `cancelling` → `cancelled` exists so the UI can say "stopping"
 * truthfully. Writing `cancelled` here would claim the spending had stopped at
 * a moment when it demonstrably had not.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { runId } = await context.params;
    const body = bodySchema.parse(await request.json());

    // Ownership is checked against the project, and the cancel is then scoped
    // to that project too: a run id alone is not authority to cancel it.
    const project = await getProjectByIdForUser(
      body.project_id,
      session.user.id
    );

    if (!project) {
      return new ChatbotError(
        "not_found:chat",
        "Project not found"
      ).toResponse();
    }

    const run = await requestRunCancellation({
      id: runId,
      projectId: project.id,
    });

    if (!run) {
      // Either the run belongs to someone else, or it finished while the user
      // was reaching for the button. Both are "nothing left to cancel", and
      // neither is an error worth interrupting them over.
      return Response.json({ run: null, cancelled: false });
    }

    return Response.json({ run, cancelled: true });
  } catch (error) {
    return irErrorToResponse(error, "Failed to cancel run");
  }
}
