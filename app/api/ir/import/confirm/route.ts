import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import {
  ImportValidationError,
  importConfirmRequestSchema,
  summarizeImportStatuses,
  validateImportConfirmationRequest,
} from "@/lib/ir/import-validation";
import { createImportedIRNodesForUser, logIREvent } from "@/lib/ir/queries";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = importConfirmRequestSchema.parse(await request.json());
    const rows = validateImportConfirmationRequest(body);
    const statusCounts = summarizeImportStatuses(rows);
    const caveatCount = rows.filter((row) => row.confidence_caveat).length;

    if (
      body.confirmation_source === "confirm_all_modal" &&
      statusCounts.active > 0
    ) {
      await logIREvent({
        projectId: body.project_id,
        topicId: body.topic_id ?? null,
        event: "import_bulk_modal_continued",
        layer: "manual",
        metadata: {
          importSessionId: body.import_session_id,
          activeCount: statusCounts.active,
          pendingCount: statusCounts.pending,
          ideaCount: statusCounts.idea,
          caveatCount,
        },
      });
    }

    const nodes = await createImportedIRNodesForUser({
      userId: session.user.id,
      projectId: body.project_id,
      topicId: body.topic_id ?? null,
      importSessionId: body.import_session_id,
      rows,
      confirmationSource:
        statusCounts.active > 0 ? body.confirmation_source : undefined,
    });

    await logIREvent({
      projectId: body.project_id,
      topicId: body.topic_id ?? null,
      event: "import_session_completed",
      layer: "manual",
      metadata: {
        importSessionId: body.import_session_id,
        activeCount: statusCounts.active,
        pendingCount: statusCounts.pending,
        ideaCount: statusCounts.idea,
        caveatCount,
        persistedCount: nodes.length,
        userEditCount: body.telemetry?.user_edit_count ?? 0,
        statusDowngradeCount: body.telemetry?.status_downgrade_count ?? 0,
      },
    });

    return Response.json(
      {
        import_session_id: body.import_session_id,
        nodes,
        counts: statusCounts,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ImportValidationError) {
      return Response.json(
        {
          code: "bad_request:ir_import",
          message: error.message,
          details: error.details,
        },
        { status: 400 }
      );
    }

    return irErrorToResponse(error, "Import confirmation failed");
  }
}
