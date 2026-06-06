import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import {
  bootstrapWorkspace,
  clearConversationSegment,
} from "@/lib/workspace/service";

const requestSchema = z.object({
  topicId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = requestSchema.parse(await request.json());
    const conversation = await clearConversationSegment({
      userId: session.user.id,
      topicId: body.topicId,
      conversationId: body.conversationId,
    });

    const workspace = await bootstrapWorkspace({
      userId: session.user.id,
      userEmail: session.user.email,
      selection: {
        topicId: body.topicId,
        conversationId: conversation.id,
      },
    });

    return Response.json({ workspace });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Clear conversation failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
