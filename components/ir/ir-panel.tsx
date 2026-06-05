"use client";

import {
  ArrowDownToLineIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  MessageSquareTextIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { irNodeKey, useIR } from "@/components/ir/ir-provider";
import { TruthGraph } from "@/components/ir/truth-graph";
import { postJSON, useIRActions } from "@/components/ir/use-ir-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { IRDetail, IREdge, IRNode } from "@/lib/ir/types";
import { getIRTypeLabel } from "@/lib/ir/types";
import { cn, fetcher } from "@/lib/utils";

function StatusBadge({ status }: { status: IRNode["status"] }) {
  return (
    <span className="text-[11px] lowercase text-[var(--ir-text-secondary)]">
      {status}
    </span>
  );
}

function getNodeTypeLabel(node: IRNode) {
  if (node.kind === "plan") {
    return node.subtype ?? "plan";
  }

  if (node.kind === "unclassified") {
    return "?";
  }

  return node.kind.replace("_", " ");
}

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

function DetailRelationList({
  detail,
  onSelect,
}: {
  detail: IRDetail;
  onSelect: (nodeId: string) => void;
}) {
  const relatedById = new Map(
    detail.relatedNodes.map((node) => [node.id, node])
  );

  if (detail.edges.length === 0) {
    return (
      <p className="text-sm text-[var(--ir-text-tertiary)]">No relations.</p>
    );
  }

  return (
    <div>
      {detail.edges.map((edge) => {
        const isOutgoing = edge.fromNode === detail.node.id;
        const targetId = isOutgoing ? edge.toNode : edge.fromNode;
        const related = relatedById.get(targetId);

        return (
          <button
            className="flex w-full items-center gap-2 border-b border-[var(--ir-border-default)] px-1 py-2 text-left text-sm hover:bg-[var(--ir-bg-hover)]"
            key={edge.id}
            onClick={() => onSelect(targetId)}
            type="button"
          >
            <span className="text-[11px] lowercase text-[var(--ir-text-tertiary)]">
              {isOutgoing ? edge.relation : `${edge.relation} by`}
            </span>
            <span className="min-w-0 flex-1 text-[var(--ir-text-primary)]">
              {targetId} · {related?.title ?? "Unknown"}
            </span>
          </button>
        );
      })}
    </div>
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

export function IRPanel() {
  const {
    candidates,
    ideas,
    isLoading,
    selectNode,
    selectedNodeId,
    truth,
    truthEdges,
    unassignedCandidates,
    unassignedIdeas,
  } = useIR();
  const { activeProjectId, queueReferenceDraft, topics } = useWorkspace();
  const [ideasExpanded, setIdeasExpanded] = useState(false);
  const [candidatesExpanded, setCandidatesExpanded] = useState(true);
  const [unassignedExpanded, setUnassignedExpanded] = useState(false);
  const [listPanePercent, setListPanePercent] = useState(55);
  const [reEntrySnapshot, setReEntrySnapshot] =
    useState<ReEntrySnapshot | null>(null);
  const [reEntryDismissed, setReEntryDismissed] = useState(false);
  const [reEntryExpanded, setReEntryExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { data: detail, mutate: mutateDetail } = useSWR<IRDetail>(
    irNodeKey(selectedNodeId),
    fetcher,
    { revalidateOnFocus: false }
  );
  const selectedNode =
    detail?.node ??
    [
      ...ideas,
      ...candidates,
      ...unassignedCandidates,
      ...unassignedIdeas,
      ...truth,
    ].find((node) => node.id === selectedNodeId) ??
    null;

  const actions = useIRActions(selectedNode, mutateDetail);

  const unassignedPool = useMemo(
    () => [...unassignedCandidates, ...unassignedIdeas],
    [unassignedCandidates, unassignedIdeas]
  );
  const truthGraphTopics = useMemo(
    () => topics.map((topic) => ({ id: topic.id, label: topic.label })),
    [topics]
  );

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

  function handleDividerPointerDown(event: React.PointerEvent<HTMLElement>) {
    const panel = panelRef.current;

    if (!panel) {
      return;
    }

    event.preventDefault();
    const rect = panel.getBoundingClientRect();

    function handlePointerMove(pointerEvent: PointerEvent) {
      const nextPercent =
        ((pointerEvent.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
      setListPanePercent(Math.min(72, Math.max(28, nextPercent)));
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[var(--ir-bg-panel)] text-[var(--ir-text-primary)]"
      data-testid="ir-panel"
      ref={panelRef}
    >
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

      <div
        className="flex min-h-0 flex-col overflow-y-auto px-0 py-2"
        style={{ flexBasis: `${listPanePercent}%` }}
      >
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

        <div className="sticky top-0 z-10 border-y border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-[var(--ir-text-secondary)]">
              Truth Graph{" "}
              <span className="text-[var(--ir-text-tertiary)]">
                ({truth.length})
              </span>
            </p>
          </div>
        </div>

        <div className="py-2" data-testid="ir-truth-zone">
          <TruthGraph
            edges={truthEdges}
            nodes={truth}
            onSelect={selectNode}
            selectedNodeId={selectedNodeId}
            topics={truthGraphTopics}
          />
        </div>
      </div>

      <button
        aria-label="Resize IR detail pane"
        className="h-1 cursor-row-resize border-y border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] focus-visible:outline-none"
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            setListPanePercent((current) => Math.max(28, current - 5));
          }

          if (event.key === "ArrowDown") {
            setListPanePercent((current) => Math.min(72, current + 5));
          }
        }}
        onPointerDown={handleDividerPointerDown}
        type="button"
      />

      <div
        className="flex min-h-[220px] flex-1 flex-col overflow-hidden"
        data-testid="ir-detail-pane"
      >
        {selectedNode ? (
          <>
            <div className="flex items-start justify-between gap-2 border-b border-[var(--ir-border-default)] px-3 py-3">
              <div className="min-w-0">
                <p className="font-[var(--ir-font-mono)] text-xs text-[var(--ir-text-secondary)]">
                  {getNodeTypeLabel(selectedNode)} {selectedNode.id}
                </p>
                <h3 className="mt-1 break-words text-base font-medium leading-[1.35] text-[var(--ir-text-primary)]">
                  {selectedNode.title}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ir-text-tertiary)]">
                  <span>
                    {getIRTypeLabel(selectedNode.kind, selectedNode.subtype)}
                  </span>
                  <span>·</span>
                  <StatusBadge status={selectedNode.status} />
                </div>
              </div>
              <Button
                className="rounded border border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                onClick={() => selectNode(null)}
                size="icon-sm"
                variant="outline"
              >
                <XIcon className="size-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <section className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ir-text-tertiary)]">
                  Rationale
                </p>
                <p className="whitespace-pre-wrap text-sm leading-[1.55] text-[var(--ir-text-primary)]">
                  {selectedNode.rationale ||
                    selectedNode.content ||
                    selectedNode.title}
                </p>
              </section>

              <section className="mt-4 space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ir-text-tertiary)]">
                  Relations
                </p>
                {detail ? (
                  <DetailRelationList detail={detail} onSelect={selectNode} />
                ) : (
                  <p className="text-sm text-[var(--ir-text-tertiary)]">
                    Loading...
                  </p>
                )}
              </section>

              <section className="mt-4 space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ir-text-tertiary)]">
                  Source
                </p>
                <p className="text-sm leading-[1.55] text-[var(--ir-text-secondary)]">
                  {selectedNode.sourceLayer ?? "manual"} ·{" "}
                  {new Date(selectedNode.createdAt).toLocaleString()}
                </p>
              </section>

              {selectedNode.kind === "unclassified" ? (
                <section className="mt-4 space-y-2 border border-[var(--ir-warning-stripe)] bg-[var(--ir-warning-bg)] p-2">
                  <p className="text-xs font-semibold text-[var(--ir-warning-fg)]">
                    Kind: not yet classified
                  </p>
                  <div className="flex gap-2">
                    <select
                      className="h-8 min-w-0 flex-1 rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 text-xs"
                      onChange={(event) => actions.setKindChoice(event.target.value)}
                      value={actions.kindChoice}
                    >
                      <option value="plan:decision">plan / decision</option>
                      <option value="plan:task">plan / task</option>
                      <option value="plan:milestone">plan / milestone</option>
                      <option value="goal:_">goal</option>
                      <option value="constraint:_">constraint</option>
                      <option value="open_question:_">open question</option>
                      <option value="hypothesis:_">hypothesis</option>
                      <option value="principle:_">principle</option>
                      <option value="rejection:_">rejection</option>
                    </select>
                    <Button
                      className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                      disabled={actions.isMutating}
                      onClick={() => actions.handleReclassify(selectedNode)}
                      size="sm"
                      variant="outline"
                    >
                      Use
                    </Button>
                  </div>
                </section>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-[var(--ir-border-default)] px-3 py-3">
              {selectedNode.status === "active" ? (
                <>
                  <Button
                    className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                    onClick={() => actions.openEdit("supersede")}
                    size="sm"
                    variant="outline"
                  >
                    <ShieldAlertIcon className="size-4" />
                    Supersede
                  </Button>
                  <Button
                    className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                    disabled={actions.isMutating}
                    onClick={() => actions.handleCreateNextStep(selectedNode)}
                    size="sm"
                    variant="outline"
                  >
                    <PlusIcon className="size-4" />
                    Create next step
                  </Button>
                  <Button
                    className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                    onClick={() =>
                      queueReferenceDraft(
                        `> [${selectedNode.id}] ${selectedNode.title}\n> ${selectedNode.content ?? selectedNode.title}`
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    <MessageSquareTextIcon className="size-4" />
                    Ask AI
                  </Button>
                  <Button
                    className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                    onClick={() => actions.handleBringToSandbox(selectedNode)}
                    size="sm"
                    variant="outline"
                  >
                    <ArrowDownToLineIcon className="size-4" />
                    Bring to sandbox
                  </Button>
                </>
              ) : null}

              {selectedNode.status === "pending" ? (
                <>
                  {detail?.edges.some(
                    (edge: IREdge) =>
                      edge.fromNode === selectedNode.id &&
                      edge.relation === "supersedes"
                  ) ? (
                    <div className="flex w-full items-start gap-2 border border-[var(--ir-warning-stripe)] bg-[var(--ir-warning-bg)] px-2 py-2 text-xs text-[var(--ir-warning-fg)]">
                      <ShieldAlertIcon className="mt-0.5 size-3.5" />
                      Confirming this will mark an older IR node as superseded.
                    </div>
                  ) : null}
                  {selectedNode.topicId ? null : (
                    <div className="flex w-full flex-col gap-2 border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 py-2">
                      <p className="text-xs font-medium text-[var(--ir-text-primary)]">
                        Assign before confirming
                      </p>
                      <select
                        className="h-8 rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] px-2 text-xs"
                        onChange={(event) =>
                          actions.setAssignmentTopicId(event.target.value)
                        }
                        value={actions.assignmentTopicId}
                      >
                        {actions.assignableTopics.map((topic) => (
                          <option key={topic.id} value={topic.id}>
                            {topic.label}
                          </option>
                        ))}
                      </select>
                      <Input
                        className="h-8 rounded border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] text-xs focus-visible:ring-0"
                        onChange={(event) =>
                          actions.setNewTopicLabel(event.target.value)
                        }
                        placeholder="Or create new judgment"
                        value={actions.newTopicLabel}
                      />
                    </div>
                  )}
                  <Button
                    className="rounded border-[var(--ir-accent-blue-border)] bg-transparent text-[var(--ir-accent-blue)] hover:bg-[var(--ir-bg-hover)]"
                    disabled={actions.isMutating}
                    onClick={() => actions.handleConfirmNode(selectedNode)}
                    size="sm"
                    variant="outline"
                  >
                    <CheckIcon className="size-4" />
                    Confirm
                  </Button>
                  <Button
                    className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                    onClick={() => actions.openEdit("confirm")}
                    size="sm"
                    variant="outline"
                  >
                    <PencilIcon className="size-4" />
                    Edit & Confirm
                  </Button>
                  <Button
                    className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                    disabled={actions.isMutating}
                    onClick={() => actions.handleDismissCandidate(selectedNode)}
                    size="sm"
                    variant="outline"
                  >
                    Ignore
                  </Button>
                </>
              ) : null}

              {selectedNode.status === "idea" ? (
                <>
                  <Button
                    className="rounded border-[var(--ir-accent-blue-border)] bg-transparent text-[var(--ir-accent-blue)] hover:bg-[var(--ir-bg-hover)]"
                    disabled={actions.isMutating}
                    onClick={() => actions.handlePromoteIdea(selectedNode)}
                    size="sm"
                    variant="outline"
                  >
                    <CircleDotIcon className="size-4" />
                    Promote
                  </Button>
                  <Button
                    className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                    disabled={actions.isMutating}
                    onClick={() => actions.handleDismissIdea(selectedNode)}
                    size="sm"
                    variant="outline"
                  >
                    Dismiss
                  </Button>
                  <Button
                    className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                    onClick={() => actions.handleBringToSandbox(selectedNode)}
                    size="sm"
                    variant="outline"
                  >
                    Bring to sandbox
                  </Button>
                </>
              ) : null}

              {selectedNode.status === "superseded" ? (
                <>
                  <Button disabled size="sm" variant="outline">
                    Restore
                  </Button>
                  <Button
                    className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                    onClick={() => actions.handleBringToSandbox(selectedNode)}
                    size="sm"
                    variant="outline"
                  >
                    Bring to sandbox
                  </Button>
                </>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col justify-center px-4 text-sm text-[var(--ir-text-tertiary)]">
            <p className="font-medium text-[var(--ir-text-primary)]">Detail</p>
            <p>Select an idea, candidate, IR node, or inline reference.</p>
          </div>
        )}
      </div>

      <Dialog
        onOpenChange={(open) => !open && actions.setEditMode(null)}
        open={Boolean(actions.editMode)}
      >
        <DialogContent className="rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)]">
          <DialogHeader>
            <DialogTitle>
              {actions.editMode === "supersede"
                ? "Draft replacement"
                : "Edit and confirm"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              className="rounded border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] focus-visible:ring-0"
              onChange={(event) => actions.setDraftTitle(event.target.value)}
              placeholder="Title"
              value={actions.draftTitle}
            />
            <Textarea
              className="min-h-28 rounded border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] focus-visible:ring-0"
              onChange={(event) => actions.setDraftContent(event.target.value)}
              placeholder="Content"
              value={actions.draftContent}
            />
            <Textarea
              className="min-h-20 rounded border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] focus-visible:ring-0"
              onChange={(event) => actions.setDraftRationale(event.target.value)}
              placeholder="Rationale"
              value={actions.draftRationale}
            />
          </div>
          <DialogFooter>
            <Button
              className="rounded border-[var(--ir-accent-blue-border)] bg-transparent text-[var(--ir-accent-blue)] hover:bg-[var(--ir-bg-hover)]"
              disabled={actions.isMutating}
              onClick={actions.submitEditDialog}
              variant="outline"
            >
              {actions.editMode === "supersede" ? "Draft candidate" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
