import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getModelById } from "@/lib/ai/models";
import { ChatbotError } from "@/lib/errors";
import { updateTopicDefaultModelForUser } from "@/lib/workspace/queries";

const requestSchema = z.object({
  modelId: z.string().min(1).max(200),
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

    if (body.modelId !== "auto" && !getModelById(body.modelId, process.env)) {
      return new ChatbotError(
        "bad_request:api",
        "Model is not available."
      ).toResponse();
    }

    const topic = await updateTopicDefaultModelForUser({
      userId: session.user.id,
      topicId: id,
      modelId: body.modelId,
    });

    return Response.json({ topic });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (error instanceof z.ZodError) {
      return new ChatbotError("bad_request:api").toResponse();
    }

    console.error("Update topic default model failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
