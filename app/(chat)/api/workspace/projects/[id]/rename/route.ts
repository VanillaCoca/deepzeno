import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { renameProjectForUser } from "@/lib/workspace/queries";
import { bootstrapWorkspace } from "@/lib/workspace/service";

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
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      return new ChatbotError(
        "bad_request:api",
        "Project name is required"
      ).toResponse();
    }

    await renameProjectForUser({
      userId: session.user.id,
      projectId: id,
      name,
    });

    const workspace = await bootstrapWorkspace({
      userId: session.user.id,
      userEmail: session.user.email,
      selection: { projectId: id },
    });

    return Response.json({ workspace });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Rename project failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
