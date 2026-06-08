import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { renameTopicForUser } from "@/lib/workspace/queries";
import { bootstrapWorkspace } from "@/lib/workspace/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      label?: unknown;
    };
    const label = typeof body.label === "string" ? body.label.trim() : "";

    if (!label) {
      return new ChatbotError(
        "bad_request:api",
        "Topic name is required"
      ).toResponse();
    }

    const topic = await renameTopicForUser({
      userId: session.user.id,
      topicId: id,
      label,
    });

    const workspace = await bootstrapWorkspace({
      userId: session.user.id,
      userEmail: session.user.email,
      selection: { projectId: topic.projectId, topicId: id },
    });

    return Response.json({ workspace });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Rename topic failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
