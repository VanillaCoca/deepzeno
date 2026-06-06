"use client";

import { ActivityIcon, ClockIcon, EyeIcon, RotateCcwIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { CodeAnchor } from "@/lib/decision-anchors";
import { fetcher } from "@/lib/utils";
import type {
  WorkspaceCandidateDecision,
  WorkspaceDecision,
} from "@/lib/workspace/types";

type AgentActivityItem = {
  log_id: string;
  created_at: string;
  agent: string;
  session_id: string | null;
  tool: string | null;
  action: string;
  decision: WorkspaceDecision | null;
  candidate: WorkspaceCandidateDecision | null;
  metadata: Record<string, unknown>;
  revertable: boolean;
};

type AgentActivityPayload = {
  items: AgentActivityItem[];
  next_cursor: string | null;
};

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ] as const;

  for (const [unit, divisor] of units) {
    if (Math.abs(seconds) >= divisor) {
      return formatter.format(Math.round(seconds / divisor), unit);
    }
  }

  return formatter.format(seconds, "second");
}

function getTitle(item: AgentActivityItem) {
  if (item.decision?.title) {
    return item.decision.title;
  }

  if (item.candidate?.proposedTitle) {
    return item.candidate.proposedTitle;
  }

  const inputSummary = item.metadata.input_summary;

  if (
    inputSummary &&
    typeof inputSummary === "object" &&
    "title" in inputSummary &&
    typeof inputSummary.title === "string" &&
    inputSummary.title
  ) {
    return inputSummary.title;
  }

  return "Untitled truth";
}

function getActionLabel(item: AgentActivityItem) {
  const title = getTitle(item);

  switch (item.action) {
    case "create":
      return `Created ${title}`;
    case "update":
      return `Updated ${title}`;
    case "archive":
      return `Archived ${title}`;
    case "supersede":
      return `Superseded ${title}`;
    case "create_edge":
      return "Created relationship";
    case "delete_edge":
      return "Deleted relationship";
    case "candidate_submitted":
      return `Submitted ${title}`;
    default:
      return `${item.action.replaceAll("_", " ")} ${title}`;
  }
}

function getAnchors(item: AgentActivityItem): CodeAnchor[] {
  const anchors = item.metadata.code_anchors_at_write;

  if (!Array.isArray(anchors)) {
    return item.decision?.codeAnchors ?? [];
  }

  return anchors.filter((anchor): anchor is CodeAnchor => {
    return (
      Boolean(anchor) &&
      typeof anchor === "object" &&
      "file" in anchor &&
      typeof anchor.file === "string" &&
      "captured_at" in anchor &&
      typeof anchor.captured_at === "string"
    );
  });
}

function formatAnchor(anchor: CodeAnchor) {
  const line =
    anchor.line_start &&
    anchor.line_end &&
    anchor.line_end !== anchor.line_start
      ? `:${anchor.line_start}-${anchor.line_end}`
      : anchor.line_start
        ? `:${anchor.line_start}`
        : "";

  return `${anchor.file}${line}`;
}

function previewMetadata(item: AgentActivityItem) {
  const preview = {
    before: item.metadata.before ?? null,
    after: item.metadata.after ?? null,
    reason: item.metadata.reason ?? null,
  };
  const serialized = JSON.stringify(preview, null, 2);

  return serialized.length > 1200
    ? `${serialized.slice(0, 1197)}...`
    : serialized;
}

export function AgentActivityPanel({
  onViewDecision,
}: {
  onViewDecision?: (decisionId: string) => void;
}) {
  const { activeProjectId, refreshWorkspace } = useWorkspace();
  const [revertingItem, setRevertingItem] = useState<AgentActivityItem | null>(
    null
  );
  const [isReverting, setIsReverting] = useState(false);
  const url = activeProjectId
    ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${activeProjectId}/agent-activity`
    : null;
  const { data, isLoading, mutate } = useSWR<AgentActivityPayload>(
    url,
    fetcher,
    {
      refreshInterval: 8000,
      revalidateOnFocus: true,
    }
  );
  const items = data?.items ?? [];
  const emptyMessage = isLoading
    ? "Loading activity..."
    : "Agents haven't touched this project yet. Connect Claude Code via your API key to get started.";
  const dialogPreview = useMemo(
    () => (revertingItem ? previewMetadata(revertingItem) : ""),
    [revertingItem]
  );

  async function handleRevert() {
    if (!(activeProjectId && revertingItem)) {
      return;
    }

    setIsReverting(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${activeProjectId}/agent-activity/${revertingItem.log_id}/revert`,
        {
          method: "POST",
        }
      );

      if (response.status === 409) {
        toast.error("This truth changed after the agent action.");
        return;
      }

      if (!response.ok) {
        throw new Error("Revert failed");
      }

      await Promise.all([mutate(), refreshWorkspace()]);
      setRevertingItem(null);
      toast.success("Agent action reverted.");
    } catch (error) {
      console.error(error);
      toast.error("Failed to revert agent action.");
    } finally {
      setIsReverting(false);
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[var(--ir-bg-panel)]"
      data-testid="agent-activity-panel"
    >
      <div className="border-b border-[var(--ir-border-default)] px-4 py-3">
        <div className="flex items-center gap-2">
          <ActivityIcon className="size-4 text-[var(--ir-text-secondary)]" />
          <p className="text-sm font-medium text-[var(--ir-text-primary)]">
            Agent Activity
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center px-5 text-center text-sm text-[var(--ir-text-tertiary)]">
            {emptyMessage}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const anchors = getAnchors(item);
              const viewDecisionId =
                item.decision?.id ??
                item.candidate?.resolvedDecisionId ??
                item.candidate?.proposedForDecisionId ??
                null;

              return (
                <article
                  className="rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-subtle)] p-3"
                  key={item.log_id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-[var(--ir-text-primary)]">
                          {getActionLabel(item)}
                        </p>
                        {item.action === "candidate_submitted" ? (
                          <Badge variant="outline">Awaiting approval</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ir-text-tertiary)]">
                        <span>{item.agent}</span>
                        {item.session_id ? (
                          <span>{item.session_id.slice(0, 10)}</span>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <ClockIcon className="size-3" />
                          {formatRelativeTime(item.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {anchors.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {anchors.slice(0, 4).map((anchor) => (
                        <span
                          className="max-w-full truncate rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] px-2 py-1 text-xs text-[var(--ir-text-secondary)]"
                          key={`${anchor.file}:${anchor.line_start ?? ""}:${anchor.commit_sha ?? ""}`}
                          title={formatAnchor(anchor)}
                        >
                          {formatAnchor(anchor)}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 flex items-center justify-end gap-2">
                    {viewDecisionId && onViewDecision ? (
                      <Button
                        onClick={() => onViewDecision(viewDecisionId)}
                        size="xs"
                        variant="outline"
                      >
                        <EyeIcon className="size-3" />
                        View
                      </Button>
                    ) : null}
                    {item.revertable ? (
                      <Button
                        onClick={() => setRevertingItem(item)}
                        size="xs"
                        variant="destructive"
                      >
                        <RotateCcwIcon className="size-3" />
                        Revert
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!(open || isReverting)) {
            setRevertingItem(null);
          }
        }}
        open={Boolean(revertingItem)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Revert Agent Action</DialogTitle>
            <DialogDescription>
              This writes a new audit log entry and restores the previous truth
              state when no later mutation is detected.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {dialogPreview}
          </pre>
          <DialogFooter>
            <Button
              disabled={isReverting}
              onClick={() => setRevertingItem(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={isReverting}
              onClick={handleRevert}
              type="button"
              variant="destructive"
            >
              <RotateCcwIcon className="size-4" />
              Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
