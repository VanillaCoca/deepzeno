import { auth } from "@/app/(auth)/auth";
import {
  AgentActivityConflictError,
  revertAgentActivityForUser,
} from "@/lib/agent-activity";
import { ChatbotError } from "@/lib/errors";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string; logId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { projectId, logId } = await context.params;
    const result = await revertAgentActivityForUser({
      userId: session.user.id,
      projectId,
      logId,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof AgentActivityConflictError) {
      return Response.json(
        {
          code: "conflict:agent_activity",
          message: error.message,
          current_state: error.currentState,
        },
        { status: 409 }
      );
    }

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Revert agent activity failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
