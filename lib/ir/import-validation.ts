import { z } from "zod";
import {
  type IRKind,
  type IRPlanSubtype,
  irKinds,
  irPlanSubtypes,
} from "@/lib/ir/types";
import {
  type ImportCandidate,
  type ImportConfirmationSource,
  type ImportConfirmRow,
  type ImportStatus,
  importActionStates,
  importConfirmationSources,
  importStatuses,
  type ValidatedImportBatch,
} from "./import-types";

export class ImportValidationError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.details = details;
  }
}

export const importCandidateSchema = z
  .object({
    kind: z.enum(irKinds),
    subtype: z.enum(irPlanSubtypes).nullable(),
    title: z.string(),
    content: z.string().nullable(),
    rationale: z.string().nullable(),
    suggested_status: z.enum(importStatuses),
    confidence_caveat: z.string().nullable(),
    source_text_span: z.string(),
  })
  .strict();

export const importExtractorResponseSchema = z
  .object({
    candidates: z.array(importCandidateSchema).default([]),
  })
  .strict();

export const importConfirmRowSchema = importCandidateSchema
  .extend({
    client_id: z.string().min(1),
    final_status: z.enum(importStatuses),
    action_state: z.enum(importActionStates),
    active_confirmed: z.boolean().optional(),
  })
  .strict();

export const importConfirmRequestSchema = z
  .object({
    project_id: z.string().uuid(),
    topic_id: z.string().uuid().nullable().optional(),
    import_session_id: z.string().uuid(),
    source_document: z.string().min(1),
    rows: z.array(importConfirmRowSchema),
    confirmation_source: z.enum(importConfirmationSources).optional(),
    bulk_truth_acknowledged: z.boolean().optional(),
    telemetry: z
      .object({
        user_edit_count: z.number().int().min(0).optional(),
        status_downgrade_count: z.number().int().min(0).optional(),
      })
      .optional(),
  })
  .strict();

export type ImportConfirmRequest = z.infer<typeof importConfirmRequestSchema>;

export function countCodePoints(value: string) {
  return Array.from(value).length;
}

function formatCandidateLabel(
  candidate: Partial<ImportCandidate>,
  index: number
) {
  return candidate.title?.trim() || `candidate ${index + 1}`;
}

function validateKindSubtype({
  kind,
  subtype,
}: {
  kind: IRKind;
  subtype: IRPlanSubtype | null;
}) {
  if (kind === "plan") {
    return Boolean(subtype && irPlanSubtypes.includes(subtype));
  }

  return subtype === null;
}

export function validateImportCandidate(
  candidate: unknown,
  sourceDocument: string
): { candidate: ImportCandidate | null; errors: string[] } {
  const parsed = importCandidateSchema.safeParse(candidate);

  if (!parsed.success) {
    return {
      candidate: null,
      errors: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const normalized: ImportCandidate = {
    ...parsed.data,
    title: parsed.data.title.trim(),
    source_text_span: parsed.data.source_text_span.trim(),
    confidence_caveat: parsed.data.confidence_caveat?.trim() || null,
    content: parsed.data.content?.trim() || null,
    rationale: parsed.data.rationale?.trim() || null,
  };
  const errors: string[] = [];

  if (!normalized.title) {
    errors.push("title is required");
  }

  if (countCodePoints(normalized.title) > 60) {
    errors.push("title must be 60 Unicode code points or fewer");
  }

  if (
    normalized.confidence_caveat &&
    countCodePoints(normalized.confidence_caveat) > 100
  ) {
    errors.push("confidence_caveat must be 100 Unicode code points or fewer");
  }

  if (!normalized.source_text_span) {
    errors.push("source_text_span is required");
  } else if (!sourceDocument.includes(normalized.source_text_span)) {
    errors.push("source_text_span must be an exact substring of the document");
  }

  if (!validateKindSubtype(normalized)) {
    errors.push("kind/subtype combination is invalid");
  }

  if (
    normalized.kind === "unclassified" &&
    normalized.suggested_status !== "pending"
  ) {
    errors.push("unclassified candidates must be pending");
  }

  return {
    candidate: errors.length === 0 ? normalized : null,
    errors,
  };
}

export function validateExtractedImportCandidates({
  candidates,
  sourceDocument,
}: {
  candidates: unknown[];
  sourceDocument: string;
}): ValidatedImportBatch {
  const seenSourceSpans = new Set<string>();
  const valid: ImportCandidate[] = [];
  const warnings: string[] = [];
  let invalidCount = 0;

  candidates.forEach((candidate, index) => {
    const validation = validateImportCandidate(candidate, sourceDocument);

    if (!validation.candidate) {
      invalidCount += 1;
      warnings.push(
        `${formatCandidateLabel(
          typeof candidate === "object" && candidate
            ? (candidate as Partial<ImportCandidate>)
            : {},
          index
        )}: ${validation.errors.join("; ")}`
      );
      return;
    }

    if (seenSourceSpans.has(validation.candidate.source_text_span)) {
      invalidCount += 1;
      warnings.push(
        `${validation.candidate.title}: duplicate source_text_span skipped`
      );
      return;
    }

    seenSourceSpans.add(validation.candidate.source_text_span);
    valid.push(validation.candidate);
  });

  return { candidates: valid, invalidCount, warnings };
}

export function filterPersistableImportRows(rows: ImportConfirmRow[]) {
  return rows.filter((row) => row.action_state !== "dismissed");
}

function toCandidateInput(row: ImportConfirmRow): ImportCandidate {
  return {
    kind: row.kind,
    subtype: row.subtype,
    title: row.title,
    content: row.content,
    rationale: row.rationale,
    suggested_status: row.suggested_status,
    confidence_caveat: row.confidence_caveat,
    source_text_span: row.source_text_span,
  };
}

export function validateImportConfirmationRequest(
  request: ImportConfirmRequest
) {
  const errors: string[] = [];
  const seenClientIds = new Set<string>();
  const rows = filterPersistableImportRows(request.rows);

  for (const [index, row] of rows.entries()) {
    const candidateValidation = validateImportCandidate(
      toCandidateInput(row),
      request.source_document
    );

    if (!candidateValidation.candidate) {
      errors.push(
        `${row.client_id || `row ${index + 1}`}: ${candidateValidation.errors.join("; ")}`
      );
    }

    if (seenClientIds.has(row.client_id)) {
      errors.push(`${row.client_id}: duplicate client_id`);
    }
    seenClientIds.add(row.client_id);

    if (row.kind === "unclassified" && row.final_status !== "pending") {
      errors.push(`${row.client_id}: unclassified rows can only be pending`);
    }

    if (row.final_status === "active") {
      if (!request.confirmation_source) {
        errors.push(
          `${row.client_id}: active import requires confirmation_source`
        );
      }

      if (request.confirmation_source === "confirm_all_modal") {
        // Constitution 2c: bulk confirmation never writes truth. Active rows
        // must go through per-row review (review_truth_row) or be demoted.
        errors.push(
          `${row.client_id}: bulk confirmation cannot write truth; demote to pending or review each truth row individually`
        );
      }

      if (
        request.confirmation_source === "review_truth_row" &&
        row.active_confirmed !== true
      ) {
        errors.push(
          `${row.client_id}: review truth active rows require per-row confirmation`
        );
      }
    }
  }

  if (rows.length === 0 && request.rows.length > 0) {
    return [];
  }

  if (errors.length > 0) {
    throw new ImportValidationError("Invalid import confirmation", errors);
  }

  return rows;
}

export function summarizeImportStatuses(
  rows: Array<{ final_status: ImportStatus }>
) {
  return rows.reduce(
    (counts, row) => {
      counts[row.final_status] += 1;
      return counts;
    },
    { active: 0, pending: 0, idea: 0 } satisfies Record<ImportStatus, number>
  );
}

export function getConfirmationSourceForActiveRows({
  rows,
  confirmationSource,
}: {
  rows: Array<{ final_status: ImportStatus }>;
  confirmationSource?: ImportConfirmationSource;
}) {
  return rows.some((row) => row.final_status === "active")
    ? confirmationSource
    : undefined;
}
