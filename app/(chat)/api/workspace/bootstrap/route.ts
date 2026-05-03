import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { bootstrapWorkspace } from "@/lib/workspace/service";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { searchParams } = new URL(request.url);
    const workspace = await bootstrapWorkspace({
      userId: session.user.id,
      userEmail: session.user.email,
      selection: {
        projectId: searchParams.get("projectId"),
        topicId: searchParams.get("topicId"),
        conversationId: searchParams.get("conversationId"),
      },
    });

    return Response.json({ workspace });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Workspace bootstrap failed", error);
    return new ChatbotError("bad_request:database").toResponse();
  }
}
