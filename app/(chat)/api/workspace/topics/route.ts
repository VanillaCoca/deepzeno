import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import {
  bootstrapWorkspace,
  createTopicWithConversation,
} from "@/lib/workspace/service";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = requestSchema.parse(await request.json());
    const bundle = await createTopicWithConversation({
      userId: session.user.id,
      projectId: body.projectId,
      label: body.label,
    });

    const workspace = await bootstrapWorkspace({
      userId: session.user.id,
      userEmail: session.user.email,
      selection: {
        projectId: body.projectId,
        topicId: bundle.topic.id,
        conversationId: bundle.conversation.id,
      },
    });

    return Response.json({ workspace });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Create topic failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
