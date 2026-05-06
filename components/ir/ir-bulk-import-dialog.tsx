"use client";

import {
  CheckIcon,
  FileUpIcon,
  PencilIcon,
  RotateCcwIcon,
  SearchCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useIR } from "@/components/ir/ir-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  type ImportCandidate,
  type ImportConfirmRow,
  type ImportReviewRow,
  type ImportStatus,
  importStatuses,
} from "@/lib/ir/import-types";
import { validateExtractedImportCandidates } from "@/lib/ir/import-validation";
import {
  getIRPrefix,
  type IRKind,
  type IRPlanSubtype,
  irKinds,
  irPlanSubtypes,
} from "@/lib/ir/types";
import { cn, generateUUID } from "@/lib/utils";

type BulkImportRow = ImportReviewRow & {
  current_status: ImportStatus;
  original_status: ImportStatus;
  is_editing: boolean;
  edited: boolean;
  active_confirmed?: boolean;
};

type ExtractResponse = {
  import_session_id: string;
  candidates: ImportCandidate[];
  invalid_count: number;
  warnings: string[];
  adapter_status: "llm" | "mock";
  adapter_warning: string | null;
  model: string;
};

type ConfirmResponse = {
  import_session_id: string;
  nodes: Array<{ id: string }>;
  counts: Record<ImportStatus, number>;
};

const statusLabels: Record<ImportStatus, string> = {
  active: "truth",
  pending: "candidate",
  idea: "idea",
};

function postJSON<T>(path: string, body: Record<string, unknown>) {
  return fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => {
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const partialCount = Array.isArray(payload?.persisted_rows)
        ? payload.persisted_rows.length
        : 0;
      const partialMessage =
        partialCount > 0
          ? ` ${partialCount} row${partialCount === 1 ? "" : "s"} may already be written.`
          : "";
      throw new Error(
        `${
          payload?.cause ??
          payload?.message ??
          payload?.error ??
          "Request failed"
        }${partialMessage}`
      );
    }

    return payload as T;
  });
}

function makeRows(candidates: ImportCandidate[]) {
  const counters = new Map<string, number>();

  return candidates.map((candidate) => {
    const prefix = getIRPrefix(candidate.kind, candidate.subtype);
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);

    return {
      ...candidate,
      client_id: generateUUID(),
      provisional_code: `${prefix}${next}?`,
      action_state: "unhandled",
      current_status: candidate.suggested_status,
      original_status: candidate.suggested_status,
      is_editing: false,
      edited: false,
    } satisfies BulkImportRow;
  });
}

function normalizeSubtype(kind: IRKind, subtype: IRPlanSubtype | null) {
  if (kind === "plan") {
    return subtype ?? "decision";
  }

  return null;
}

function rowTypeLabel(row: Pick<BulkImportRow, "kind" | "subtype">) {
  if (row.kind === "plan") {
    return row.subtype ?? "decision";
  }

  return row.kind === "unclassified" ? "?" : row.kind.replace("_", " ");
}

function getStripeStyle(row: BulkImportRow) {
  if (row.confidence_caveat) {
    return {
      width: "4px",
      background: "var(--ir-warning-stripe)",
    };
  }

  if (row.current_status === "active") {
    return {
      width: "4px",
      background: "var(--ir-accent-blue)",
    };
  }

  if (row.current_status === "pending") {
    return {
      width: "2px",
      background: "var(--ir-accent-blue-border)",
    };
  }

  return { width: "0px", background: "transparent" };
}

function CountSummary({ rows }: { rows: BulkImportRow[] }) {
  const counts = rows.reduce(
    (memo, row) => {
      if (row.action_state !== "dismissed") {
        memo[row.current_status] += 1;
      }
      return memo;
    },
    { active: 0, pending: 0, idea: 0 } as Record<ImportStatus, number>
  );

  return (
    <p className="text-xs text-[var(--ir-text-tertiary)]">
      {counts.active} truth, {counts.pending} candidates, {counts.idea} ideas
    </p>
  );
}

export function IRBulkImportDialog({ disabled }: { disabled?: boolean }) {
  const { activeProjectId, activeTopic, activeTopicId } = useWorkspace();
  const { refreshIR } = useIR();
  const [open, setOpen] = useState(false);
  const [sourceDocument, setSourceDocument] = useState("");
  const [importSessionId, setImportSessionId] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkImportRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [adapterWarning, setAdapterWarning] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [reviewTruthIds, setReviewTruthIds] = useState<Set<string> | null>(
    null
  );
  const [userEditCount, setUserEditCount] = useState(0);
  const [statusDowngradeCount, setStatusDowngradeCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importTopicId = activeTopic?.isGeneral ? null : activeTopicId;
  const visibleRows = rows.filter((row) => row.action_state !== "dismissed");
  const reviewRows = reviewTruthIds
    ? rows.filter((row) => reviewTruthIds.has(row.client_id))
    : visibleRows;
  const activeCount = visibleRows.filter(
    (row) => row.current_status === "active"
  ).length;
  const confirmAllCounts = useMemo(
    () =>
      visibleRows.reduce(
        (memo, row) => {
          memo[row.current_status] += 1;
          if (row.current_status === "active" && row.confidence_caveat) {
            memo.caveatActive += 1;
          }
          return memo;
        },
        { active: 0, pending: 0, idea: 0, caveatActive: 0 }
      ),
    [visibleRows]
  );
  const canExtract = Boolean(activeProjectId && sourceDocument.trim());

  function resetImport() {
    setSourceDocument("");
    setImportSessionId(null);
    setRows([]);
    setWarnings([]);
    setAdapterWarning(null);
    setReviewTruthIds(null);
    setUserEditCount(0);
    setStatusDowngradeCount(0);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!(file.name.endsWith(".md") || file.type.includes("markdown"))) {
      toast.error("Upload a .md markdown file.");
      event.target.value = "";
      return;
    }

    setSourceDocument(await file.text());
  }

  async function runExtraction() {
    if (!(activeProjectId && sourceDocument.trim())) {
      return;
    }

    setIsExtracting(true);
    setWarnings([]);
    setAdapterWarning(null);
    setReviewTruthIds(null);

    try {
      const payload = await postJSON<ExtractResponse>(
        "/api/ir/import/extract",
        {
          project_id: activeProjectId,
          topic_id: importTopicId,
          source_document: sourceDocument,
        }
      );
      const clientValidation = validateExtractedImportCandidates({
        candidates: payload.candidates,
        sourceDocument,
      });
      const nextRows = makeRows(clientValidation.candidates);

      setImportSessionId(payload.import_session_id);
      setRows(nextRows);
      setWarnings([...payload.warnings, ...clientValidation.warnings]);
      setAdapterWarning(payload.adapter_warning);

      if (payload.adapter_status === "mock") {
        toast.warning("Using the dev-only mock import extractor.");
      } else {
        toast.success(`Extracted ${nextRows.length} import candidates.`);
      }

      if (payload.invalid_count + clientValidation.invalidCount > 0) {
        toast.warning(
          `${payload.invalid_count + clientValidation.invalidCount} invalid rows were skipped.`
        );
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Import extraction failed."
      );
    } finally {
      setIsExtracting(false);
    }
  }

  function updateRow(
    clientId: string,
    updater: (row: BulkImportRow) => BulkImportRow,
    options?: { edit?: boolean; downgrade?: boolean }
  ) {
    setRows((current) =>
      current.map((row) => (row.client_id === clientId ? updater(row) : row))
    );

    if (options?.edit) {
      setUserEditCount((count) => count + 1);
    }

    if (options?.downgrade) {
      setStatusDowngradeCount((count) => count + 1);
    }
  }

  function rowToConfirmPayload(
    row: BulkImportRow,
    finalStatus = row.current_status
  ): ImportConfirmRow {
    return {
      kind: row.kind,
      subtype: row.subtype,
      title: row.title,
      content: row.content,
      rationale: row.rationale,
      suggested_status: finalStatus,
      confidence_caveat: row.confidence_caveat,
      source_text_span: row.source_text_span,
      client_id: row.client_id,
      final_status: finalStatus,
      action_state: row.action_state,
      active_confirmed: row.active_confirmed,
    };
  }

  async function confirmRows({
    rowsToPersist,
    confirmationSource,
    bulkTruthAcknowledged,
    successMessage,
  }: {
    rowsToPersist: ImportConfirmRow[];
    confirmationSource?: "review_truth_row" | "confirm_all_modal";
    bulkTruthAcknowledged?: boolean;
    successMessage: string;
  }) {
    if (!(activeProjectId && importSessionId)) {
      toast.error("Run extraction before confirming import rows.");
      return;
    }

    if (rowsToPersist.length === 0) {
      toast.message("No rows to import.");
      return;
    }

    setIsConfirming(true);

    try {
      await postJSON<ConfirmResponse>("/api/ir/import/confirm", {
        project_id: activeProjectId,
        topic_id: importTopicId,
        import_session_id: importSessionId,
        source_document: sourceDocument,
        rows: rowsToPersist,
        confirmation_source: confirmationSource,
        bulk_truth_acknowledged: bulkTruthAcknowledged,
        telemetry: {
          user_edit_count: userEditCount,
          status_downgrade_count: statusDowngradeCount,
        },
      });
      const persistedClientIds = new Set(
        rowsToPersist.map((row) => row.client_id)
      );

      setRows((current) =>
        current.filter((row) => !persistedClientIds.has(row.client_id))
      );
      await refreshIR();
      toast.success(successMessage);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Import confirmation failed."
      );
    } finally {
      setIsConfirming(false);
      setConfirmAllOpen(false);
    }
  }

  async function confirmIdeasAndCandidates() {
    const selectedRows = visibleRows.filter((row) =>
      ["idea", "pending"].includes(row.current_status)
    );
    const pendingCount = selectedRows.filter(
      (row) => row.current_status === "pending"
    ).length;
    const ideaCount = selectedRows.filter(
      (row) => row.current_status === "idea"
    ).length;

    await confirmRows({
      rowsToPersist: selectedRows.map((row) =>
        rowToConfirmPayload(row, row.current_status)
      ),
      successMessage: `${pendingCount} items imported as candidates, ${ideaCount} as ideas.`,
    });
  }

  function openTruthReview() {
    const ids = new Set(
      visibleRows
        .filter((row) => row.current_status === "active")
        .map((row) => row.client_id)
    );

    if (ids.size === 0) {
      toast.message("No truth suggestions to review.");
      return;
    }

    setReviewTruthIds(ids);
  }

  async function finishTruthReview() {
    if (!reviewTruthIds) {
      return;
    }

    const selectedRows = rows
      .filter(
        (row) =>
          reviewTruthIds.has(row.client_id) && row.action_state !== "dismissed"
      )
      .map((row) => {
        const finalStatus =
          row.action_state === "unhandled" ? "pending" : row.current_status;
        return rowToConfirmPayload(
          {
            ...row,
            action_state:
              row.action_state === "unhandled" ? "demoted" : row.action_state,
            active_confirmed:
              finalStatus === "active" ? row.active_confirmed : false,
          },
          finalStatus
        );
      });

    await confirmRows({
      rowsToPersist: selectedRows,
      confirmationSource: selectedRows.some(
        (row) => row.final_status === "active"
      )
        ? "review_truth_row"
        : undefined,
      successMessage: "Truth review imported.",
    });
    setReviewTruthIds(null);
  }

  async function confirmAllAsSuggested() {
    const selectedRows = visibleRows.map((row) =>
      rowToConfirmPayload(
        {
          ...row,
          action_state:
            row.current_status === "active" ? "confirmed" : row.action_state,
          active_confirmed: row.current_status === "active",
        },
        row.current_status
      )
    );

    await confirmRows({
      rowsToPersist: selectedRows,
      confirmationSource: selectedRows.some(
        (row) => row.final_status === "active"
      )
        ? "confirm_all_modal"
        : undefined,
      bulkTruthAcknowledged: true,
      successMessage: "Bulk import confirmed.",
    });
  }

  function renderRow(row: BulkImportRow) {
    const isReviewRow = reviewTruthIds?.has(row.client_id);
    const isDismissed = row.action_state === "dismissed";

    if (isDismissed && !isReviewRow) {
      return null;
    }

    return (
      <div
        className={cn(
          "grid min-w-[920px] grid-cols-[8px_150px_90px_minmax(260px,1fr)_120px_220px] border-b border-[var(--ir-border-default)] text-sm",
          row.confidence_caveat && "bg-[var(--ir-warning-bg)]/60",
          isDismissed && "opacity-45"
        )}
        key={row.client_id}
      >
        <div className="py-3">
          <div className="h-full" style={getStripeStyle(row)} />
        </div>
        <div className="px-2 py-3">
          {row.is_editing ? (
            <div className="flex flex-col gap-2">
              <select
                className="h-8 rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 text-xs"
                onChange={(event) => {
                  const kind = event.target.value as IRKind;
                  updateRow(
                    row.client_id,
                    (current) => ({
                      ...current,
                      kind,
                      subtype: normalizeSubtype(kind, current.subtype),
                      current_status:
                        kind === "unclassified"
                          ? "pending"
                          : current.current_status,
                      edited: true,
                    }),
                    { edit: true }
                  );
                }}
                value={row.kind}
              >
                {irKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind.replace("_", " ")}
                  </option>
                ))}
              </select>
              {row.kind === "plan" ? (
                <select
                  className="h-8 rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 text-xs"
                  onChange={(event) =>
                    updateRow(
                      row.client_id,
                      (current) => ({
                        ...current,
                        subtype: event.target.value as IRPlanSubtype,
                        edited: true,
                      }),
                      { edit: true }
                    )
                  }
                  value={row.subtype ?? "decision"}
                >
                  {irPlanSubtypes.map((subtype) => (
                    <option key={subtype} value={subtype}>
                      {subtype}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : (
            <p
              className={cn(
                "text-xs lowercase text-[var(--ir-text-tertiary)]",
                row.kind === "unclassified" && "text-[var(--ir-warning-fg)]"
              )}
            >
              {rowTypeLabel(row)}
            </p>
          )}
        </div>
        <div className="px-2 py-3 font-mono text-xs text-[var(--ir-text-secondary)]">
          {row.provisional_code}
        </div>
        <div className="min-w-0 px-2 py-3">
          {row.is_editing ? (
            <input
              className="h-8 w-full rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 text-sm"
              maxLength={120}
              onChange={(event) =>
                updateRow(
                  row.client_id,
                  (current) => ({
                    ...current,
                    title: event.target.value,
                    edited: true,
                  }),
                  { edit: true }
                )
              }
              value={row.title}
            />
          ) : (
            <p className="leading-[1.4] text-[var(--ir-text-primary)]">
              {row.title}
            </p>
          )}
          {row.confidence_caveat ? (
            <p className="mt-1 text-xs text-[var(--ir-warning-fg)]">
              {row.confidence_caveat}
            </p>
          ) : null}
          <p className="mt-1 line-clamp-2 text-xs text-[var(--ir-text-tertiary)]">
            {row.source_text_span}
          </p>
        </div>
        <div className="px-2 py-3">
          {row.is_editing ? (
            <select
              className="h-8 rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 text-xs"
              onChange={(event) => {
                const nextStatus = event.target.value as ImportStatus;
                const finalStatus =
                  row.kind === "unclassified" ? "pending" : nextStatus;
                updateRow(
                  row.client_id,
                  (current) => ({
                    ...current,
                    current_status: finalStatus,
                    edited: true,
                    active_confirmed:
                      finalStatus === "active"
                        ? current.active_confirmed
                        : false,
                  }),
                  {
                    edit: true,
                    downgrade:
                      row.current_status === "active" &&
                      finalStatus !== "active",
                  }
                );
              }}
              value={row.current_status}
            >
              {importStatuses.map((status) => (
                <option
                  disabled={row.kind === "unclassified" && status !== "pending"}
                  key={status}
                  value={status}
                >
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs lowercase text-[var(--ir-text-secondary)]">
              {statusLabels[row.current_status]}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-1.5 px-2 py-2.5">
          {reviewTruthIds ? (
            <Button
              className="h-7 rounded border-[var(--ir-accent-blue-border)] bg-transparent px-2 text-xs text-[var(--ir-accent-blue)] hover:bg-[var(--ir-bg-hover)]"
              onClick={() =>
                updateRow(
                  row.client_id,
                  (current) => ({
                    ...current,
                    current_status: "active",
                    action_state: "confirmed",
                    active_confirmed: true,
                  }),
                  { edit: true }
                )
              }
              variant="outline"
            >
              Confirm as truth
            </Button>
          ) : (
            <Button
              className="h-7 rounded border-[var(--ir-border-strong)] bg-transparent px-2 text-xs hover:bg-[var(--ir-bg-hover)]"
              onClick={() =>
                updateRow(row.client_id, (current) => ({
                  ...current,
                  is_editing: !current.is_editing,
                }))
              }
              variant="outline"
            >
              <PencilIcon className="size-3" />
              Edit
            </Button>
          )}
          <Button
            className="h-7 rounded border-[var(--ir-border-strong)] bg-transparent px-2 text-xs hover:bg-[var(--ir-bg-hover)]"
            onClick={() =>
              updateRow(
                row.client_id,
                (current) => ({
                  ...current,
                  current_status: "pending",
                  action_state: "demoted",
                  active_confirmed: false,
                }),
                {
                  edit: true,
                  downgrade: row.current_status === "active",
                }
              )
            }
            variant="outline"
          >
            Demote pending
          </Button>
          <Button
            className="h-7 rounded border-[var(--ir-border-strong)] bg-transparent px-2 text-xs hover:bg-[var(--ir-bg-hover)]"
            disabled={row.kind === "unclassified"}
            onClick={() =>
              updateRow(
                row.client_id,
                (current) => ({
                  ...current,
                  current_status: "idea",
                  action_state: "demoted",
                  active_confirmed: false,
                }),
                {
                  edit: true,
                  downgrade: row.current_status === "active",
                }
              )
            }
            variant="outline"
          >
            Demote idea
          </Button>
          <Button
            className="h-7 rounded border-[var(--ir-border-strong)] bg-transparent px-2 text-xs hover:bg-[var(--ir-bg-hover)]"
            onClick={() =>
              updateRow(row.client_id, (current) => ({
                ...current,
                action_state: "dismissed",
                active_confirmed: false,
              }))
            }
            variant="outline"
          >
            <Trash2Icon className="size-3" />
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setReviewTruthIds(null);
          }
        }}
        open={open}
      >
        <DialogTrigger asChild>
          <Button disabled={disabled} size="sm" variant="outline">
            <FileUpIcon className="size-4" />
            Import
          </Button>
        </DialogTrigger>
        <DialogContent
          className="h-[min(820px,calc(100dvh-2rem))] w-[min(1120px,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] p-0 sm:max-w-[min(1120px,calc(100vw-2rem))]"
          showCloseButton={!isConfirming}
        >
          <DialogHeader className="border-b border-[var(--ir-border-default)] px-5 py-4">
            <DialogTitle className="text-base">Bulk Import</DialogTitle>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--ir-text-tertiary)]">
                Upload or paste markdown, then review candidates before writing.
              </p>
              {visibleRows.length > 0 ? <CountSummary rows={rows} /> : null}
            </div>
          </DialogHeader>

          <div className="grid min-h-0 grid-cols-[420px_minmax(0,1fr)] overflow-hidden">
            <div className="min-h-0 overflow-auto border-r border-[var(--ir-border-default)] p-4">
              <input
                accept=".md,text/markdown,text/plain"
                className="hidden"
                onChange={handleFileChange}
                ref={fileInputRef}
                type="file"
              />
              <div className="mb-3 flex gap-2">
                <Button
                  className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                  variant="outline"
                >
                  <FileUpIcon className="size-4" />
                  Upload .md
                </Button>
                <Button
                  className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                  onClick={resetImport}
                  size="sm"
                  variant="outline"
                >
                  <RotateCcwIcon className="size-4" />
                  Reset
                </Button>
              </div>
              <Textarea
                className="h-[calc(100%-3.25rem)] min-h-[520px] resize-none rounded border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] text-sm focus-visible:ring-0"
                onChange={(event) => setSourceDocument(event.target.value)}
                placeholder="Paste markdown here..."
                value={sourceDocument}
              />
              {adapterWarning ? (
                <p className="mt-3 border-l-4 border-[var(--ir-warning-stripe)] bg-[var(--ir-warning-bg)] px-3 py-2 text-xs text-[var(--ir-warning-fg)]">
                  {adapterWarning}
                </p>
              ) : null}
              {warnings.length > 0 ? (
                <div className="mt-3 text-xs text-[var(--ir-text-tertiary)]">
                  {warnings.length} validation warning
                  {warnings.length === 1 ? "" : "s"}.
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--ir-border-default)] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[var(--ir-text-primary)]">
                    {reviewTruthIds ? "Review truth" : "Review table"}
                  </p>
                  <p className="text-xs text-[var(--ir-text-tertiary)]">
                    Provisional codes are display-only until confirmation.
                  </p>
                </div>
                <Button
                  className="rounded border-[var(--ir-accent-blue-border)] bg-transparent text-[var(--ir-accent-blue)] hover:bg-[var(--ir-bg-hover)]"
                  disabled={!canExtract || isExtracting || isConfirming}
                  onClick={runExtraction}
                  size="sm"
                  variant="outline"
                >
                  <SearchCheckIcon className="size-4" />
                  {isExtracting ? "Extracting..." : "Run extraction"}
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {reviewRows.length > 0 ? (
                  <div>
                    <div className="grid min-w-[920px] grid-cols-[8px_150px_90px_minmax(260px,1fr)_120px_220px] border-b border-[var(--ir-border-strong)] bg-[var(--ir-bg-elevated)] text-[11px] uppercase text-[var(--ir-text-tertiary)]">
                      <div />
                      <div className="px-2 py-2">kind</div>
                      <div className="px-2 py-2">code</div>
                      <div className="px-2 py-2">title / source</div>
                      <div className="px-2 py-2">status</div>
                      <div className="px-2 py-2">actions</div>
                    </div>
                    {reviewRows.map(renderRow)}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--ir-text-tertiary)]">
                    Run extraction to populate import candidates.
                  </div>
                )}
              </div>

              <DialogFooter className="shrink-0 flex-row flex-wrap justify-end border-t border-[var(--ir-border-default)] px-4 py-3">
                {reviewTruthIds ? (
                  <>
                    <Button
                      className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                      disabled={isConfirming}
                      onClick={() => setReviewTruthIds(null)}
                      variant="outline"
                    >
                      Cancel
                    </Button>
                    <Button
                      className="rounded border-[var(--ir-accent-blue-border)] bg-transparent text-[var(--ir-accent-blue)] hover:bg-[var(--ir-bg-hover)]"
                      disabled={isConfirming}
                      onClick={finishTruthReview}
                      variant="outline"
                    >
                      <CheckIcon className="size-4" />
                      Finish review
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                      disabled={isConfirming || visibleRows.length === 0}
                      onClick={confirmIdeasAndCandidates}
                      variant="outline"
                    >
                      Confirm ideas + candidates
                    </Button>
                    <Button
                      className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                      disabled={isConfirming || activeCount === 0}
                      onClick={openTruthReview}
                      variant="outline"
                    >
                      Review truth ({activeCount})
                    </Button>
                    <Button
                      className="rounded border-[var(--ir-accent-blue-border)] bg-transparent text-[var(--ir-accent-blue)] hover:bg-[var(--ir-bg-hover)]"
                      disabled={isConfirming || visibleRows.length === 0}
                      onClick={() => setConfirmAllOpen(true)}
                      variant="outline"
                    >
                      Confirm all as suggested
                    </Button>
                  </>
                )}
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={setConfirmAllOpen} open={confirmAllOpen}>
        <AlertDialogContent className="border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm bulk import</AlertDialogTitle>
            <AlertDialogDescription className="text-left leading-6">
              This will write {confirmAllCounts.active} items as truth,{" "}
              {confirmAllCounts.pending} as candidates, {confirmAllCounts.idea}{" "}
              as ideas - including {confirmAllCounts.caveatActive} truth items
              the AI flagged with concerns.
              <br />
              <br />
              Truth items skip individual review in this flow. You remain
              accountable for each judgment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConfirming}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="border-[var(--ir-accent-blue)] bg-[var(--ir-accent-blue)] text-white hover:bg-[var(--ir-accent-blue-hover)]"
              disabled={isConfirming}
              onClick={(event) => {
                event.preventDefault();
                confirmAllAsSuggested().catch(console.error);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
