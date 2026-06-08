import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { deleteProjectForUser } from "@/lib/workspace/queries";
import {
  bootstrapWorkspace,
  createProjectWithDefaults,
} from "@/lib/workspace/service";

const requestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = requestSchema.parse(await request.json());
    const bundle = await createProjectWithDefaults({
      userId: session.user.id,
      userEmail: session.user.email,
      name: body.name,
    });

    const workspace = await bootstrapWorkspace({
      userId: session.user.id,
      userEmail: session.user.email,
      selection: {
        projectId: bundle.project.id,
        topicId: bundle.generalTopic.id,
        conversationId: bundle.firstConversation.id,
      },
    });

    return Response.json({ workspace });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Create project failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const projectId = new URL(request.url).searchParams.get("projectId");
    const parsed = z.string().uuid().safeParse(projectId);

    if (!parsed.success) {
      return new ChatbotError("bad_request:api").toResponse();
    }

    const deleted = await deleteProjectForUser(parsed.data, session.user.id);

    return Response.json({ deleted });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Delete project failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
