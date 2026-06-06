import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import {
  extractImportCandidates,
  ImportExtractionUnavailableError,
} from "@/lib/ir/import-extraction";
import { validateExtractedImportCandidates } from "@/lib/ir/import-validation";
import { logIREvent } from "@/lib/ir/queries";
import { generateUUID } from "@/lib/utils";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

const extractSchema = z.object({
  project_id: z.string().uuid(),
  topic_id: z.string().uuid().nullable().optional(),
  source_document: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = extractSchema.parse(await request.json());
    const project = await getProjectByIdForUser(
      body.project_id,
      session.user.id
    );

    if (!project) {
      return new ChatbotError(
        "forbidden:chat",
        "Project not found"
      ).toResponse();
    }

    const importSessionId = generateUUID();

    await logIREvent({
      projectId: body.project_id,
      topicId: body.topic_id ?? null,
      event: "import_session_started",
      layer: "manual",
      metadata: {
        importSessionId,
        documentChars: body.source_document.length,
      },
    });

    const extraction = await extractImportCandidates(body.source_document);
    const validated = validateExtractedImportCandidates({
      candidates: extraction.candidates,
      sourceDocument: body.source_document,
    });
    const counts = validated.candidates.reduce(
      (memo, candidate) => {
        memo[candidate.suggested_status] += 1;
        if (candidate.confidence_caveat) {
          memo.caveat += 1;
        }
        return memo;
      },
      { active: 0, pending: 0, idea: 0, caveat: 0 }
    );

    await Promise.all(
      validated.candidates.map((candidate) =>
        logIREvent({
          projectId: body.project_id,
          topicId: body.topic_id ?? null,
          event: "import_row_validated",
          layer: "manual",
          metadata: {
            importSessionId,
            kind: candidate.kind,
            subtype: candidate.subtype,
            suggestedStatus: candidate.suggested_status,
            hasCaveat: Boolean(candidate.confidence_caveat),
          },
        })
      )
    );

    if (validated.invalidCount > 0) {
      await logIREvent({
        projectId: body.project_id,
        topicId: body.topic_id ?? null,
        event: "import_row_validation_failed",
        layer: "manual",
        metadata: {
          importSessionId,
          invalidCount: validated.invalidCount,
          warnings: validated.warnings.slice(0, 10),
        },
      });
    }

    await logIREvent({
      projectId: body.project_id,
      topicId: body.topic_id ?? null,
      event: "import_extraction_completed",
      layer: "manual",
      metadata: {
        importSessionId,
        model: extraction.model,
        adapterStatus: extraction.adapterStatus,
        totalExtractedRows: extraction.candidates.length,
        invalidSkippedRows: validated.invalidCount,
        activeCount: counts.active,
        pendingCount: counts.pending,
        ideaCount: counts.idea,
        caveatCount: counts.caveat,
      },
    });

    return Response.json({
      import_session_id: importSessionId,
      candidates: validated.candidates,
      invalid_count: validated.invalidCount,
      warnings: validated.warnings,
      adapter_status: extraction.adapterStatus,
      adapter_warning: extraction.warning,
      model: extraction.model,
    });
  } catch (error) {
    if (error instanceof ImportExtractionUnavailableError) {
      return Response.json(
        {
          code: "service_unavailable:ir_import",
          message: error.message,
          candidates: [],
        },
        { status: error.statusCode }
      );
    }

    return irErrorToResponse(error, "Import extraction failed");
  }
}
