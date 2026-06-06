import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { promoteIRNodeForUser } from "@/lib/ir/queries";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { id } = await context.params;
    const node = await promoteIRNodeForUser({ userId: session.user.id, id });
    return Response.json({ node });
  } catch (error) {
    return irErrorToResponse(error, "Promote IR node failed");
  }
}
