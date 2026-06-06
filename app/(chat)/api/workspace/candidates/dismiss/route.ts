import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { dismissAllCandidates } from "@/lib/candidate-actions";
import { ChatbotError } from "@/lib/errors";
import { getTopicTruthSnapshot } from "@/lib/workspace/service";

const requestSchema = z.object({
  topicId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = requestSchema.parse(await request.json());
    await dismissAllCandidates({
      userId: session.user.id,
      topicId: body.topicId,
    });

    const snapshot = await getTopicTruthSnapshot({
      userId: session.user.id,
      topicId: body.topicId,
    });

    return Response.json(snapshot);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Dismiss candidates failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
