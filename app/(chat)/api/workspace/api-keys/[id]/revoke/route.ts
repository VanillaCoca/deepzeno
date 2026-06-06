import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import {
  listProjectApiKeysForUser,
  revokeProjectApiKeyForUser,
} from "@/lib/mcp/api-keys";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = (await request.json().catch(() => ({}))) as {
      projectId?: string;
    };
    const { id } = await params;

    if (!body.projectId) {
      return new ChatbotError(
        "bad_request:api",
        "projectId is required"
      ).toResponse();
    }

    await revokeProjectApiKeyForUser({
      keyId: id,
      projectId: body.projectId,
      userId: session.user.id,
    });

    const apiKeys = await listProjectApiKeysForUser({
      projectId: body.projectId,
      userId: session.user.id,
    });

    return Response.json({ apiKeys });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Revoke API key failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
