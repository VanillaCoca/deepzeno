"use client";

import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { getNodeTypeLabel, IRDetailPane } from "@/components/ir/ir-detail";
import { irNodeKey, useIR } from "@/components/ir/ir-provider";
import { postJSON, useIRActions } from "@/components/ir/use-ir-actions";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { IRDetail, IRNode } from "@/lib/ir/types";
import { cn, fetcher } from "@/lib/utils";

function NodeButton({
  node,
  selected,
  onSelect,
}: {
  node: IRNode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className={cn(
        "relative block w-full border-b border-[var(--ir-border-default)] px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--ir-bg-hover)]",
        selected &&
          "bg-[var(--ir-bg-hover)] before:absolute before:left-0 before:top-0 before:h-full before:w-0.5 before:bg-[var(--ir-accent-blue)]"
      )}
      onClick={() => onSelect(node.id)}
      title={node.title}
      type="button"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-[11px] lowercase tracking-[0.02em] text-[var(--ir-text-tertiary)]",
            node.kind === "unclassified" && "text-[var(--ir-warning-fg)]"
          )}
        >
          {getNodeTypeLabel(node)}
        </span>
        <span className="font-[var(--ir-font-mono)] text-xs text-[var(--ir-text-secondary)]">
          {node.id}
        </span>
      </div>
      <div
        className={cn(
          "ir-row-title mt-1 text-sm font-normal leading-[1.4] text-[var(--ir-text-primary)]",
          node.status === "superseded" &&
            "text-[var(--ir-text-tertiary)] line-through",
          node.status === "idea" && "text-[var(--ir-text-tertiary)]"
        )}
      >
        {node.title}
      </div>
    </button>
  );
}

function ZoneHeader({
  count,
  expanded,
  hidden,
  label,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  hidden?: boolean;
  label: string;
  onToggle: () => void;
}) {
  if (hidden) {
    return null;
  }

  return (
    <button
      className="flex h-8 w-full items-center gap-2 px-1 text-left text-[13px] font-medium text-[var(--ir-text-secondary)]"
      onClick={onToggle}
      type="button"
    >
      {expanded ? (
        <ChevronDownIcon className="size-3.5" />
      ) : (
        <ChevronRightIcon className="size-3.5" />
      )}
      <span>{label}</span>
      <span className="text-[var(--ir-text-tertiary)]">({count})</span>
    </button>
  );
}

type ReEntrySnapshot = {
  absence_seconds: number | null;
  last_seen_at: string | null;
  since: {
    new_candidates: number;
    superseded_truth: number;
    unresolved_open_questions: number;
    mcp_writes: number;
  };
};

const RE_ENTRY_LIGHT_THRESHOLD_SECONDS = 30 * 60;
const RE_ENTRY_FULL_THRESHOLD_SECONDS = 24 * 60 * 60;

function getReEntryTotal(snapshot: ReEntrySnapshot) {
  return Object.values(snapshot.since).reduce((sum, count) => sum + count, 0);
}

function getNeedsReviewCount(snapshot: ReEntrySnapshot) {
  return (
    snapshot.since.new_candidates + snapshot.since.unresolved_open_questions
  );
}

function shouldShowReEntry(
  snapshot: ReEntrySnapshot | null,
  dismissed: boolean
) {
  if (dismissed || !snapshot || snapshot.absence_seconds === null) {
    return false;
  }

  return (
    snapshot.absence_seconds >= RE_ENTRY_LIGHT_THRESHOLD_SECONDS &&
    getReEntryTotal(snapshot) > 0
  );
}

function ReEntryBanner({
  expanded,
  onDismiss,
  onGoTo,
  onToggleExpanded,
  snapshot,
}: {
  expanded: boolean;
  onDismiss: () => void;
  onGoTo: (zone: "ideas" | "candidates" | "truth") => void;
  onToggleExpanded: () => void;
  snapshot: ReEntrySnapshot;
}) {
  const total = getReEntryTotal(snapshot);
  const needsReview = getNeedsReviewCount(snapshot);
  const shouldUseFullCard =
    expanded ||
    (snapshot.absence_seconds ?? 0) >= RE_ENTRY_FULL_THRESHOLD_SECONDS;
  const items = [
    {
      key: "new_candidates",
      label: "New candidates",
      value: snapshot.since.new_candidates,
      detail: `${snapshot.since.new_candidates} need review`,
      zone: "candidates" as const,
    },
    {
      key: "superseded_truth",
      label: "Superseded truth",
      value: snapshot.since.superseded_truth,
      detail: `${snapshot.since.superseded_truth} changed`,
      zone: "truth" as const,
    },
    {
      key: "unresolved_open_questions",
      label: "Unresolved open questions",
      value: snapshot.since.unresolved_open_questions,
      detail: `${snapshot.since.unresolved_open_questions} need review`,
      zone: "truth" as const,
    },
    {
      key: "mcp_writes",
      label: "MCP writes",
      value: snapshot.since.mcp_writes,
      detail: `${snapshot.since.mcp_writes} agent writes since last visit`,
      zone: "truth" as const,
    },
  ].filter((item) => item.value > 0);

  if (!shouldUseFullCard) {
    return (
      <button
        className="flex w-full items-center justify-between gap-3 border-b border-[var(--ir-border-default)] px-3 py-2 text-left text-xs text-[var(--ir-text-secondary)] hover:bg-[var(--ir-bg-hover)]"
        onClick={onToggleExpanded}
        type="button"
      >
        <span>
          Since last visit: {total} updates · {needsReview} need review
        </span>
        <ChevronRightIcon className="size-3.5 text-[var(--ir-text-tertiary)]" />
      </button>
    );
  }

  return (
    <div className="border-b border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--ir-text-primary)]">
            Since last visit
          </p>
          <p className="mt-0.5 text-xs text-[var(--ir-text-tertiary)]">
            {total} updates · {needsReview} need review
          </p>
        </div>
        <Button
          className="rounded border border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
          onClick={onDismiss}
          size="icon-sm"
          variant="outline"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <div className="mt-3 divide-y divide-[var(--ir-border-default)] border-y border-[var(--ir-border-default)]">
        {items.map((item) => (
          <button
            className="flex w-full items-center justify-between gap-3 px-1 py-2 text-left hover:bg-[var(--ir-bg-hover)]"
            key={item.key}
            onClick={() => onGoTo(item.zone)}
            type="button"
          >
            <span className="text-sm text-[var(--ir-text-primary)]">
              {item.label} ({item.value})
            </span>
            <span className="text-xs text-[var(--ir-text-tertiary)]">
              {item.detail}
            </span>
          </button>
        ))}
      </div>
      <Button
        className="mt-3 w-full rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
        onClick={onDismiss}
        size="sm"
        variant="outline"
      >
        Mark all reviewed
      </Button>
    </div>
  );
}

export function IRDrawer({
  open,
  onClose,
  onNavigateToTruth,
}: {
  open: boolean;
  onClose: () => void;
  onNavigateToTruth?: () => void;
}) {
  const {
    candidates,
    ideas,
    isLoading,
    selectNode,
    selectedNodeId,
    unassignedCandidates,
    unassignedIdeas,
  } = useIR();
  const { activeProjectId } = useWorkspace();
  const [ideasExpanded, setIdeasExpanded] = useState(false);
  const [candidatesExpanded, setCandidatesExpanded] = useState(true);
  const [unassignedExpanded, setUnassignedExpanded] = useState(false);
  const [reEntrySnapshot, setReEntrySnapshot] =
    useState<ReEntrySnapshot | null>(null);
  const [reEntryDismissed, setReEntryDismissed] = useState(false);
  const [reEntryExpanded, setReEntryExpanded] = useState(false);

  const { data: detail, mutate: mutateDetail } = useSWR<IRDetail>(
    irNodeKey(selectedNodeId),
    fetcher,
    { revalidateOnFocus: false }
  );

  const unassignedPool = useMemo(
    () => [...unassignedCandidates, ...unassignedIdeas],
    [unassignedCandidates, unassignedIdeas]
  );

  // The drawer's detail pane is scoped to NON-truth nodes (ideas/candidates/
  // unassigned). Truth nodes selected from the stage share selectedNodeId but
  // show their detail there, not here.
  const selectedDrawerNode =
    [...ideas, ...candidates, ...unassignedPool].find(
      (node) => node.id === selectedNodeId
    ) ?? null;
  const actions = useIRActions(selectedDrawerNode, mutateDetail);

  useEffect(() => {
    if (unassignedPool.length > 0) {
      setUnassignedExpanded(true);
    }
  }, [unassignedPool.length]);

  useEffect(() => {
    if (!activeProjectId) {
      setReEntrySnapshot(null);
      return;
    }

    let cancelled = false;
    setReEntryDismissed(false);
    setReEntryExpanded(false);

    fetcher(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${activeProjectId}/re-entry`
    )
      .then((payload: ReEntrySnapshot) => {
        if (!cancelled) {
          setReEntrySnapshot(payload);
        }
      })
      .catch((error) => {
        console.error("Failed to load re-entry snapshot", error);
        if (!cancelled) {
          setReEntrySnapshot(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    const url = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${activeProjectId}/re-entry/mark-seen`;

    function markSeenOnExit() {
      fetch(url, { keepalive: true, method: "POST" }).catch(() => undefined);
    }

    window.addEventListener("pagehide", markSeenOnExit);
    return () => {
      window.removeEventListener("pagehide", markSeenOnExit);
    };
  }, [activeProjectId]);

  async function markReEntrySeen() {
    if (!activeProjectId) {
      return;
    }

    setReEntryDismissed(true);

    try {
      // Fire-and-forget: no toast/isMutating gate (see useIRActions.runMutation for the gated path).
      await postJSON(`/api/projects/${activeProjectId}/re-entry/mark-seen`);
    } catch (error) {
      console.error("Failed to mark re-entry reviewed", error);
    }
  }

  function handleReEntryGoTo(zone: "ideas" | "candidates" | "truth") {
    // Truth nodes now live in the TruthGraphStage center view, not the drawer.
    // Switch the workspace to the truth-graph view (which also closes the
    // drawer) instead of scrolling to a zone that no longer exists.
    if (zone === "truth") {
      onNavigateToTruth?.();
      return;
    }

    if (zone === "ideas") {
      setIdeasExpanded(true);
    }

    if (zone === "candidates") {
      setCandidatesExpanded(true);
    }

    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-testid="ir-${zone}-zone"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  return (
    <>
      {open ? (
        <button
          aria-label="Close panel"
          className="fixed inset-0 z-30 bg-black/20"
          onClick={onClose}
          type="button"
        />
      ) : null}
      <aside
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-[420px] max-w-[90vw] flex-col border-l border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] shadow-xl transition-transform duration-200",
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
        data-testid="ir-drawer"
        inert={!open}
      >
        <header className="flex items-center justify-between border-b border-[var(--ir-border-default)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--ir-text-primary)]">
            Ideas & Candidates
          </span>
          <Button
            aria-label="Close"
            className="rounded border border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
            onClick={onClose}
            size="icon-sm"
            variant="outline"
          >
            <XIcon className="size-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {shouldShowReEntry(reEntrySnapshot, reEntryDismissed) &&
          reEntrySnapshot ? (
            <ReEntryBanner
              expanded={reEntryExpanded}
              onDismiss={markReEntrySeen}
              onGoTo={handleReEntryGoTo}
              onToggleExpanded={() => setReEntryExpanded(true)}
              snapshot={reEntrySnapshot}
            />
          ) : null}

          <div className="flex flex-col px-0 py-2">
            <ZoneHeader
              count={ideas.length}
              expanded={ideasExpanded}
              label="Ideas"
              onToggle={() => setIdeasExpanded((current) => !current)}
            />
            {ideasExpanded ? (
              <div className="mb-2" data-testid="ir-ideas-zone">
                {ideas.length === 0 && !isLoading ? (
                  <p className="px-3.5 py-2 text-sm text-[var(--ir-text-tertiary)]">
                    No ideas yet.
                  </p>
                ) : null}
                {ideas.slice(0, 10).map((node) => (
                  <NodeButton
                    key={node.id}
                    node={node}
                    onSelect={selectNode}
                    selected={selectedNodeId === node.id}
                  />
                ))}
                {ideas.length > 10 ? (
                  <button
                    className="px-3.5 py-2 text-xs text-[var(--ir-text-tertiary)]"
                    type="button"
                  >
                    + {ideas.length - 10} more
                  </button>
                ) : null}
              </div>
            ) : null}

            <ZoneHeader
              count={candidates.length}
              expanded={candidatesExpanded}
              label="Candidates"
              onToggle={() => setCandidatesExpanded((current) => !current)}
            />
            {candidatesExpanded ? (
              <div className="mb-3" data-testid="ir-candidates-zone">
                {candidates.length === 0 && !isLoading ? (
                  <p className="px-3.5 py-2 text-sm text-[var(--ir-text-tertiary)]">
                    No pending candidates.
                  </p>
                ) : null}
                {candidates.map((node) => (
                  <NodeButton
                    key={node.id}
                    node={node}
                    onSelect={selectNode}
                    selected={selectedNodeId === node.id}
                  />
                ))}
              </div>
            ) : null}

            {unassignedPool.length > 0 ? (
              <>
                <ZoneHeader
                  count={unassignedPool.length}
                  expanded={unassignedExpanded}
                  label="Unassigned pool"
                  onToggle={() => setUnassignedExpanded((current) => !current)}
                />
                {unassignedExpanded ? (
                  <div className="mb-3" data-testid="ir-unassigned-zone">
                    {unassignedPool.map((node) => (
                      <NodeButton
                        key={node.id}
                        node={node}
                        onSelect={selectNode}
                        selected={selectedNodeId === node.id}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {selectedDrawerNode ? (
          <div className="h-2/5 min-h-[220px] overflow-auto border-t border-[var(--ir-border-default)]">
            <IRDetailPane
              actions={actions}
              detail={detail}
              selectedNode={selectedDrawerNode}
            />
          </div>
        ) : null}
      </aside>
    </>
  );
}
