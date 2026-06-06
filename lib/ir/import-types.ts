import type { IRKind, IRPlanSubtype } from "@/lib/ir/types";

export const importStatuses = ["idea", "pending", "active"] as const;
export const importActionStates = [
  "unhandled",
  "confirmed",
  "demoted",
  "dismissed",
] as const;
export const importConfirmationSources = [
  "review_truth_row",
  "confirm_all_modal",
] as const;

export type ImportStatus = (typeof importStatuses)[number];
export type ImportActionState = (typeof importActionStates)[number];
export type ImportConfirmationSource =
  (typeof importConfirmationSources)[number];

export type ImportCandidate = {
  kind: IRKind;
  subtype: IRPlanSubtype | null;
  title: string;
  content: string | null;
  rationale: string | null;
  suggested_status: ImportStatus;
  confidence_caveat: string | null;
  source_text_span: string;
};

export type ImportReviewRow = ImportCandidate & {
  client_id: string;
  provisional_code?: string;
  action_state: ImportActionState;
};

export type ImportConfirmRow = ImportCandidate & {
  client_id: string;
  final_status: ImportStatus;
  action_state: ImportActionState;
  active_confirmed?: boolean;
};

export type ValidatedImportBatch = {
  candidates: ImportCandidate[];
  invalidCount: number;
  warnings: string[];
};
