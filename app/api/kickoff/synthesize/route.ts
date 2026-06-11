import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getKickoffStateForProject } from "@/lib/ir/queries";
import { runKickoffSynthesis } from "@/lib/kickoff/synthesis";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

const bodySchema = z.object({ project_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = bodySchema.parse(await request.json());
    const project = await getProjectByIdForUser(
      body.project_id,
      session.user.id
    );

    if (!project) {
      return new ChatbotError(
        "forbidden:chat",
        "Project not found"
      ).toResponse();
    }

    const state = await getKickoffStateForProject(body.project_id);

    if (state === "confirmed" || state === "skipped") {
      return new ChatbotError(
        "bad_request:api",
        "Kickoff already completed for this project"
      ).toResponse();
    }

    const { proposal, model } = await runKickoffSynthesis({
      projectId: body.project_id,
    });

    return Response.json({ proposal, model });
  } catch (error) {
    return irErrorToResponse(error, "Kickoff synthesis failed");
  }
}
