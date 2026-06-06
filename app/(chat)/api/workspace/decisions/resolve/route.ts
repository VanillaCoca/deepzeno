import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { resolveOpenQuestionForUser } from "@/lib/workspace/service";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = (await request.json()) as {
      decisionId?: string;
      topicId?: string;
      kind?: "plan" | "constraint" | "principle" | "hypothesis" | "goal";
      title?: string;
      content?: string;
      rationale?: string | null;
    };

    if (
      !body.decisionId ||
      !body.kind ||
      !body.title?.trim() ||
      !body.content?.trim()
    ) {
      return new ChatbotError(
        "bad_request:api",
        "decisionId, kind, title, and content are required"
      ).toResponse();
    }

    const result = await resolveOpenQuestionForUser({
      userId: session.user.id,
      decisionId: body.decisionId,
      kind: body.kind,
      title: body.title.trim(),
      content: body.content.trim(),
      rationale: body.rationale?.trim() || null,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Resolve open question failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
