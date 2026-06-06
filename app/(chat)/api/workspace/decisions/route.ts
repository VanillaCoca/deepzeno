import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { getTopicTruthSnapshot } from "@/lib/workspace/service";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { searchParams } = new URL(request.url);
    const topicId = searchParams.get("topicId");

    if (!topicId) {
      return new ChatbotError(
        "bad_request:api",
        "topicId is required"
      ).toResponse();
    }

    const snapshot = await getTopicTruthSnapshot({
      userId: session.user.id,
      topicId,
    });

    return Response.json(snapshot);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Load decisions failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
