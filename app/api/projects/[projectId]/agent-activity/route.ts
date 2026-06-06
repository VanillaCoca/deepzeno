import { auth } from "@/app/(auth)/auth";
import {
  type AgentActivityItem,
  listAgentActivityForUser,
} from "@/lib/agent-activity";
import { ChatbotError } from "@/lib/errors";

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
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor");
    const limitParam = Number(searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitParam) ? limitParam : 50;
    const payload: {
      items: AgentActivityItem[];
      next_cursor: string | null;
    } = await listAgentActivityForUser({
      userId: session.user.id,
      projectId,
      cursor,
      limit,
    });

    return Response.json(payload);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Load agent activity failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
