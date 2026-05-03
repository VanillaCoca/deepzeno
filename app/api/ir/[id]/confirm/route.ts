import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse, irKindSchema, irSubtypeSchema } from "@/lib/ir/api";
import { confirmIRNodeForUser, getIRDetailForUser } from "@/lib/ir/queries";

const confirmSchema = z
  .object({
    edits: z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        content: z.string().nullable().optional(),
        rationale: z.string().nullable().optional(),
        kind: irKindSchema.optional(),
        subtype: irSubtypeSchema.nullable().optional(),
        sensitivity: z.enum(["normal", "vault"]).optional(),
      })
      .optional(),
  })
  .default({});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = confirmSchema.parse(await request.json().catch(() => ({})));
    const { id } = await context.params;
    const node = await confirmIRNodeForUser({
      userId: session.user.id,
      id,
      edits: body.edits,
    });
    const detail = await getIRDetailForUser({
      id: node.id,
      userId: session.user.id,
    });

    return Response.json(detail ?? { node, edges: [], relatedNodes: [] });
  } catch (error) {
    return irErrorToResponse(error, "Confirm IR node failed");
  }
}
