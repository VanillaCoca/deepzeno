import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { getProjectReEntrySnapshot } from "@/lib/workspace/re-entry";
import { getProjectReEntryOverlay } from "@/lib/workspace/re-entry-overlay";

// GET /api/projects/[projectId]/re-entry
//
// One call, one watermark read, both shapes: the legacy `since`/`items` counts
// and the amendment №4 §2 overlay model. They are served together on purpose —
// two endpoints would mean two reads of `last_seen_at` at slightly different
// moments, and the two surfaces could then disagree about what "since" means.
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { projectId } = await context.params;
    const snapshot = await getProjectReEntrySnapshot({
      userId: session.user.id,
      projectId,
    });

    // The snapshot has already asserted project access and read the watermark;
    // the overlay builds on those exact values rather than re-deriving them.
    const { overlay, uncoveredKinds } = await getProjectReEntryOverlay({
      userId: session.user.id,
      projectId,
      absenceSeconds: snapshot.absence_seconds,
      lastSeenAt: snapshot.last_seen_at,
    });

    return Response.json({
      ...snapshot,
      overlay,
      uncovered_change_kinds: uncoveredKinds,
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Load project re-entry failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
