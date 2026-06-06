import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { markProjectSeenForUser } from "@/lib/workspace/re-entry";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { projectId } = await context.params;
    const state = await markProjectSeenForUser({
      userId: session.user.id,
      projectId,
    });

    return Response.json(state);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Mark project seen failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
