import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { getProjectReEntrySnapshot } from "@/lib/workspace/re-entry";

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

    return Response.json(snapshot);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Load project re-entry failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
