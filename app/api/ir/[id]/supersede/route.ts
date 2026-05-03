import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse, irKindSchema, irSubtypeSchema } from "@/lib/ir/api";
import {
  createSupersedingIRNodeForUser,
  getIRDetailForUser,
} from "@/lib/ir/queries";

const supersedeSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
  kind: irKindSchema.optional(),
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
    const body = supersedeSchema.parse(await request.json());
    const node = await createSupersedingIRNodeForUser({
      userId: session.user.id,
      id,
      title: body.title,
      content: body.content,
      rationale: body.rationale,
      kind: body.kind,
      subtype: body.subtype,
    });
    const detail = await getIRDetailForUser({
      id: node.id,
      userId: session.user.id,
    });

    return Response.json(detail ?? { node, edges: [], relatedNodes: [] }, {
      status: 201,
    });
  } catch (error) {
    return irErrorToResponse(error, "Supersede IR node failed");
  }
}
