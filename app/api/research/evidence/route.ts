import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getIRNodeForUser } from "@/lib/ir/queries";
import { listEvidenceForNode } from "@/lib/research/queries";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const nodeId = new URL(request.url).searchParams.get("nodeId");

    if (!nodeId) {
      return new ChatbotError(
        "bad_request:api",
        "nodeId required"
      ).toResponse();
    }

    const node = await getIRNodeForUser({
      id: nodeId,
      userId: session.user.id,
    });

    if (!node) {
      return new ChatbotError(
        "not_found:chat",
        "IR node not found"
      ).toResponse();
    }

    const evidence = await listEvidenceForNode({ nodeId });

    return Response.json({ evidence });
  } catch (error) {
    return irErrorToResponse(error, "Failed to list evidence");
  }
}
