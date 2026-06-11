import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import {
  irCreatedBySchema,
  irErrorToResponse,
  irKindSchema,
  irRelationInputSchema,
  irSubtypeSchema,
  normalizeRelationInput,
} from "@/lib/ir/api";
import {
  createIRNodeForUser,
  findDuplicateIRCandidate,
  getIRDetailForUser,
} from "@/lib/ir/queries";

const draftSchema = z.object({
  kind: irKindSchema,
  subtype: irSubtypeSchema.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  content: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
  project_id: z.string().uuid(),
  topic_id: z.string().uuid().nullable().optional(),
  source_chat_id: z.string().uuid().nullable().optional(),
  source_turn_id: z.string().uuid().nullable().optional(),
  // Drafts come from the user/UI (manual, inline) or test fixtures exercising
  // the sweep idea path. Server-side funnels (mcp, kickoff) have their own
  // write paths and must not be spoofable through this route.
  source_layer: z.enum(["manual", "inline", "sweep"]),
  created_by: irCreatedBySchema,
  initial_status: z.enum(["pending", "idea"]).default("pending"),
  extraction_confidence: z.number().nullable().optional(),
  reactivation_anchor_id: z.string().nullable().optional(),
  relations: z.array(irRelationInputSchema).default([]),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = draftSchema.parse(await request.json());
    const duplicate = await findDuplicateIRCandidate({
      projectId: body.project_id,
      kind: body.kind,
      subtype: body.subtype ?? null,
      title: body.title,
    });

    if (duplicate) {
      return Response.json(
        { merged_with: duplicate.id, node: duplicate },
        { status: 409 }
      );
    }

    const node = await createIRNodeForUser({
      userId: session.user.id,
      projectId: body.project_id,
      topicId: body.topic_id ?? null,
      kind: body.kind,
      subtype: body.subtype ?? null,
      title: body.title,
      content: body.content ?? null,
      rationale: body.rationale ?? null,
      sourceChatId: body.source_chat_id ?? null,
      sourceTurnId: body.source_turn_id ?? null,
      sourceLayer: body.source_layer,
      createdBy: body.created_by,
      initialStatus: body.initial_status,
      extractionConfidence: body.extraction_confidence ?? null,
      reactivationAnchorId: body.reactivation_anchor_id ?? null,
      relations: body.relations.map(normalizeRelationInput),
    });
    const detail = await getIRDetailForUser({
      id: node.id,
      userId: session.user.id,
    });

    return Response.json(detail ?? { node, edges: [], relatedNodes: [] }, {
      status: 201,
    });
  } catch (error) {
    return irErrorToResponse(error, "Create IR draft failed");
  }
}
