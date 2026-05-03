import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import {
  irErrorToResponse,
  irKindSchema,
  irStatusSchema,
  irSubtypeSchema,
} from "@/lib/ir/api";
import { listIREdgesForProject, listIRNodesForUser } from "@/lib/ir/queries";

const querySchema = z.object({
  project_id: z.string().uuid(),
  topic_id: z.string().uuid().nullable().optional(),
  status: irStatusSchema.optional(),
  kind: irKindSchema.optional(),
  subtype: irSubtypeSchema.nullable().optional(),
  q: z.string().max(200).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({
      project_id: searchParams.get("project_id"),
      topic_id: searchParams.get("topic_id"),
      status: searchParams.get("status") ?? undefined,
      kind: searchParams.get("kind") ?? undefined,
      subtype: searchParams.get("subtype") ?? undefined,
      q: searchParams.get("q"),
    });
    const nodes = await listIRNodesForUser({
      userId: session.user.id,
      projectId: input.project_id,
      topicId: input.topic_id,
      status: input.status,
      kind: input.kind,
      subtype: input.subtype,
      query: input.q,
    });
    const edges =
      input.status === "active"
        ? await listIREdgesForProject({
            userId: session.user.id,
            projectId: input.project_id,
          })
        : [];

    return Response.json({ nodes, edges });
  } catch (error) {
    return irErrorToResponse(error, "List IR nodes failed");
  }
}
