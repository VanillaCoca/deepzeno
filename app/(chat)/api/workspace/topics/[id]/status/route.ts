import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import {
  bootstrapWorkspace,
  updateTopicStatusForUser,
} from "@/lib/workspace/service";
import { topicStatuses } from "@/lib/workspace/types";

const requestSchema = z.object({
  status: z.enum(topicStatuses),
  description: z.string().trim().max(1000).nullable().optional(),
});

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
    const body = requestSchema.parse(await request.json());
    const topic = await updateTopicStatusForUser({
      userId: session.user.id,
      topicId: id,
      status: body.status,
      description: body.description,
    });
    const workspace = await bootstrapWorkspace({
      userId: session.user.id,
      userEmail: session.user.email,
      selection: {
        projectId: topic.projectId,
        topicId: topic.id,
      },
    });

    return Response.json({ topic, workspace });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Update topic status failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
