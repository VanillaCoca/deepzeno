import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse, irKindSchema, irSubtypeSchema } from "@/lib/ir/api";
import {
  confirmIRNodeForUser,
  getIRDetailForUser,
  getIRNodeForUser,
} from "@/lib/ir/queries";
import { createTopicWithConversation } from "@/lib/workspace/service";

const confirmSchema = z
  .object({
    assign_to_topic_id: z.string().uuid().optional(),
    create_topic_label: z.string().trim().min(1).max(120).optional(),
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
  .refine(
    (body) => !(body.assign_to_topic_id && body.create_topic_label),
    "Choose an existing topic or create a new topic, not both."
  )
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
    let assignedTopicId = body.assign_to_topic_id ?? null;

    if (body.create_topic_label) {
      const sourceNode = await getIRNodeForUser({
        id,
        userId: session.user.id,
      });

      if (!sourceNode) {
        throw new ChatbotError("not_found:chat", "IR node not found");
      }

      const bundle = await createTopicWithConversation({
        userId: session.user.id,
        projectId: sourceNode.projectId,
        label: body.create_topic_label,
      });
      assignedTopicId = bundle.topic.id;
    }

    const node = await confirmIRNodeForUser({
      userId: session.user.id,
      id,
      topicId: assignedTopicId,
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
