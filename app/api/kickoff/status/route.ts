import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getKickoffStateForProject } from "@/lib/ir/queries";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const projectId = new URL(request.url).searchParams.get("projectId");

    if (!projectId) {
      return new ChatbotError(
        "bad_request:api",
        "projectId required"
      ).toResponse();
    }

    const project = await getProjectByIdForUser(projectId, session.user.id);

    if (!project) {
      return new ChatbotError(
        "forbidden:chat",
        "Project not found"
      ).toResponse();
    }

    const state = await getKickoffStateForProject(projectId);

    return Response.json({ state });
  } catch (error) {
    return irErrorToResponse(error, "Kickoff status failed");
  }
}
