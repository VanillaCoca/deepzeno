import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { listPendingInboxForUser } from "@/lib/ir/inbox-queries";
import { IRNotReadyError } from "@/lib/ir/queries";

const querySchema = z.object({
  project_id: z.string().uuid(),
});

// GET /api/ir/inbox?project_id=... — the cross-topic judgment queue, ranked by
// blast radius (PRD K1/K2). Read-only; rulings go through /api/ir/[id]/*.
export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({
      project_id: searchParams.get("project_id"),
    });

    try {
      const { items, ideaCount } = await listPendingInboxForUser({
        userId: session.user.id,
        projectId: input.project_id,
      });
      // `idea_count` is what the queue is NOT showing. The queue itself is
      // unchanged — ideas still do not ask for a ruling — but an empty inbox
      // sitting on top of 51 unshown ideas is a lie of omission, and the
      // number was one query away the whole time.
      return Response.json({
        items,
        idea_count: ideaCount,
        not_migrated: false,
      });
    } catch (error) {
      if (error instanceof IRNotReadyError) {
        // Pre-migration database — render an empty inbox instead of a 503.
        return Response.json({ items: [], idea_count: 0, not_migrated: true });
      }
      throw error;
    }
  } catch (error) {
    return irErrorToResponse(error, "Failed to load judgment inbox");
  }
}
