import { z } from "zod";
import { AllowanceExhaustedError } from "@/lib/billing/funding";
import { ChatbotError } from "@/lib/errors";
import {
  IRConflictError,
  IRImportPartialFailureError,
  IRNotReadyError,
} from "@/lib/ir/queries";
import {
  irCreatedByValues,
  irKinds,
  irPlanSubtypes,
  irRelations,
  irStatuses,
} from "@/lib/ir/types";

export const irKindSchema = z.enum(irKinds);
export const irSubtypeSchema = z.enum(irPlanSubtypes);
export const irStatusSchema = z.enum(irStatuses);
export const irCreatedBySchema = z.enum(irCreatedByValues);
export const irRelationSchema = z.enum(irRelations);

export const irRelationInputSchema = z.object({
  relation: irRelationSchema,
  to_node: z.string().min(1).optional(),
  toNode: z.string().min(1).optional(),
  target_id: z.string().min(1).optional(),
  is_anchor_hint: z.boolean().optional(),
  isAnchorHint: z.boolean().optional(),
  label: z.string().max(80).nullish(),
});

export function normalizeRelationInput(
  relation: z.infer<typeof irRelationInputSchema>
) {
  return {
    relation: relation.relation,
    toNode: relation.toNode ?? relation.to_node ?? relation.target_id ?? "",
    isAnchorHint: relation.isAnchorHint ?? relation.is_anchor_hint ?? false,
    label: relation.label ?? null,
  };
}

export function irErrorToResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof z.ZodError) {
    return new ChatbotError(
      "bad_request:api",
      "Invalid IR request"
    ).toResponse();
  }

  if (error instanceof IRConflictError) {
    return Response.json(
      { code: "conflict:ir", message: error.message },
      { status: error.statusCode }
    );
  }

  if (error instanceof IRNotReadyError) {
    return Response.json(
      {
        code: "service_unavailable:ir",
        message: error.message,
        nodes: [],
        edges: [],
      },
      { status: error.statusCode }
    );
  }

  if (error instanceof IRImportPartialFailureError) {
    return Response.json(
      {
        code: "partial_failure:ir_import",
        message: error.message,
        persisted_rows: error.persistedRows,
      },
      { status: error.statusCode }
    );
  }

  // Mapped here rather than in each route because the fallback below would
  // otherwise answer 400 "check your input and try again" — a sentence that is
  // both wrong and unactionable for a user whose only problem is that the free
  // allowance ran out. The 402 and its dollar figure are the difference between
  // a dead end and a thirty-second fix in Settings.
  if (error instanceof AllowanceExhaustedError) {
    return new ChatbotError(
      "payment_required:allowance",
      error.message
    ).toResponse();
  }

  if (error instanceof ChatbotError) {
    return error.toResponse();
  }

  console.error(fallbackMessage, error);
  return new ChatbotError("bad_request:api").toResponse();
}
