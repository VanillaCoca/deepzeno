import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse, irKindSchema, irSubtypeSchema } from "@/lib/ir/api";
import { reclassifyIRNodeForUser } from "@/lib/ir/queries";

const reclassifySchema = z.object({
  kind: irKindSchema,
  subtype: irSubtypeSchema.nullable().optional(),
});

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
    const body = reclassifySchema.parse(await request.json());
    const result = await reclassifyIRNodeForUser({
      userId: session.user.id,
      id,
      kind: body.kind,
      subtype: body.subtype ?? null,
    });

    return Response.json({
      old_id: result.oldId,
      new_id: result.newId,
      status: result.node.status,
      node: result.node,
    });
  } catch (error) {
    return irErrorToResponse(error, "Reclassify IR node failed");
  }
}
