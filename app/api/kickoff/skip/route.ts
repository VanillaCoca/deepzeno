import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { logIREvent } from "@/lib/ir/queries";
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

    await logIREvent({
      projectId: body.project_id,
      event: "kickoff_skipped",
      layer: "kickoff",
      metadata: null,
    });

    return Response.json({ state: "skipped" });
  } catch (error) {
    return irErrorToResponse(error, "Kickoff skip failed");
  }
}
