import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { getWorkspaceMessagesForSandbox } from "@/lib/workspace/service";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { searchParams } = new URL(request.url);
    const messageIds = searchParams.getAll("ids");
    const messages = await getWorkspaceMessagesForSandbox({
      userId: session.user.id,
      messageIds,
    });

    return Response.json({ messages });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Load workspace messages failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
