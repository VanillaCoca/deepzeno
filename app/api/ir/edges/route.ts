import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { listIREdgesForProject } from "@/lib/ir/queries";

const querySchema = z.object({
  project_id: z.string().uuid(),
});

// Returns every IR edge in the project (across all stages). The truth graph's
// "All" mode uses this to draw cross-stage relationships
// (idea → candidate → truth); callers filter to whichever nodes are visible.
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

    const edges = await listIREdgesForProject({
      userId: session.user.id,
      projectId: input.project_id,
    });

    return Response.json({ edges });
  } catch (error) {
    return irErrorToResponse(error, "List IR edges failed");
  }
}
