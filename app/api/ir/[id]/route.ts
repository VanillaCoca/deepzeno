import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getIRDetailForUser } from "@/lib/ir/queries";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { id } = await context.params;
    const detail = await getIRDetailForUser({ id, userId: session.user.id });

    if (!detail) {
      return new ChatbotError(
        "not_found:chat",
        "IR node not found"
      ).toResponse();
    }

    return Response.json(detail);
  } catch (error) {
    return irErrorToResponse(error, "Load IR node failed");
  }
}
