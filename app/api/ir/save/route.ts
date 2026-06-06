import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse, irKindSchema, irSubtypeSchema } from "@/lib/ir/api";
import { saveIRSelectionForUser } from "@/lib/ir/queries";

const saveSchema = z.object({
  project_id: z.string().uuid(),
  topic_id: z.string().uuid().nullable().optional(),
  source_chat_id: z.string().uuid().nullable().optional(),
  source_turn_id: z.string().uuid().nullable().optional(),
  source_text_span: z.string(),
  user_kind_choice: z
    .object({
      kind: irKindSchema,
      subtype: irSubtypeSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = saveSchema.parse(await request.json());
    const node = await saveIRSelectionForUser({
      userId: session.user.id,
      projectId: body.project_id,
      topicId: body.topic_id ?? null,
      sourceChatId: body.source_chat_id ?? null,
      sourceTurnId: body.source_turn_id ?? null,
      sourceTextSpan: body.source_text_span,
      userKindChoice: body.user_kind_choice
        ? {
            kind: body.user_kind_choice.kind,
            subtype: body.user_kind_choice.subtype ?? null,
          }
        : null,
    });

    return Response.json(
      {
        ...node,
        kind_suggestion_pending: node.kind === "unclassified",
      },
      { status: 201 }
    );
  } catch (error) {
    return irErrorToResponse(error, "Save IR selection failed");
  }
}
