"use client";

import {
  ArrowDownToLineIcon,
  CheckIcon,
  CircleDotIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useIR } from "@/components/ir/ir-provider";
import { kindPresentation } from "@/components/ir/kind-presentation";
import type { useIRActions } from "@/components/ir/use-ir-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { IRDetail, IRNode } from "@/lib/ir/types";
import { cn } from "@/lib/utils";

// Semantic accent is carried by the icon only; the buttons themselves stay calm
// and native so the action column reads as buttons, not bordered text.
const ACTION_ICON = {
  confirm: "text-[var(--z-confirmed)]",
  sandbox: "text-[var(--z-attention-text)]",
  promote: "text-[var(--ir-accent-blue)]",
  neutral: "text-[var(--ir-text-tertiary)]",
} as const;

type ActionRole = keyof typeof ACTION_ICON;

function actionVariant(tone: ActionRole, primary?: boolean) {
  if (primary) {
    return "secondary" as const;
  }
  if (tone === "neutral") {
    return "ghost" as const;
  }
  return "outline" as const;
}

// One action = a short explanation on the left, a real button on the right.
// The buttons share a min-width so they line up into a tidy right-hand column;
// a single action then reads like a calm card.
function ActionItem({
  caption,
  disabled,
  icon: Icon,
  label,
  onClick,
  primary,
  tone,
}: {
  caption: string;
  disabled?: boolean;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  onClick?: () => void;
  primary?: boolean;
  tone: ActionRole;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <p className="min-w-0 flex-1 text-xs leading-snug text-[var(--ir-text-secondary)]">
        {caption}
      </p>
      <Button
        className={cn(
          "min-w-[116px] justify-center",
          primary && "font-semibold"
        )}
        disabled={disabled}
        onClick={onClick}
        size="sm"
        variant={actionVariant(tone, primary)}
      >
        <Icon className={cn("size-4", ACTION_ICON[tone])} />
        {label}
      </Button>
    </div>
  );
}

export function StatusBadge({ status }: { status: IRNode["status"] }) {
  return (
    <span className="text-[11px] lowercase text-[var(--ir-text-secondary)]">
      {status}
    </span>
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

function ActionColumn({
  actions,
  detail,
  selectedNode,
}: {
  actions: ReturnType<typeof useIRActions>;
  detail: IRDetail | undefined;
  selectedNode: IRNode;
}) {
  const { queueReferenceDraft } = useWorkspace();
  const confirmability = selectedNode.confirmability;
  // Forward-compatible default: until Lixian produces the field, treat absent
  // as confirmable (contract zeno-confirmability-contract.md §4).
  const needsDiscussion = confirmability?.status === "needs_discussion";

  if (selectedNode.status === "active") {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto" />
        <div className="flex shrink-0 flex-col divide-y divide-[var(--ir-border-default)]">
          <ActionItem
            caption="Bring this truth back to the sandbox to re-evaluate."
            icon={ArrowDownToLineIcon}
            label="Re-evaluate"
            onClick={() => actions.handleBringToSandbox(selectedNode)}
            primary
            tone="sandbox"
          />
        </div>
      </>
    );
  }

  if (selectedNode.status === "pending") {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {detail?.edges.some(
            (edge) =>
              edge.fromNode === selectedNode.id &&
              edge.relation === "supersedes"
          ) ? (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--ir-warning-stripe)] bg-[var(--ir-warning-bg)] px-2 py-2 text-xs text-[var(--ir-warning-fg)]">
              <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              Confirming this will mark an older IR node as superseded.
            </div>
          ) : null}
          {selectedNode.topicId ? null : (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 py-2">
              <p className="text-xs font-medium text-[var(--ir-text-primary)]">
                Assign to a judgment before confirming
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
                placeholder="or create a new judgment"
                value={actions.newTopicLabel}
              />
            </div>
          )}
          {needsDiscussion ? (
            <div className="rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 py-2 text-xs text-[var(--ir-text-secondary)]">
              This is actually an open question — keep discussing it.
              {confirmability?.reason ? (
                <span className="mt-1 block text-[var(--ir-text-tertiary)]">
                  {confirmability.reason}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col divide-y divide-[var(--ir-border-default)]">
          {needsDiscussion ? null : (
            <ActionItem
              caption="Mark this candidate as a confirmed truth."
              disabled={actions.isMutating}
              icon={CheckIcon}
              label="Confirm"
              onClick={() => actions.handleConfirmNode(selectedNode)}
              primary
              tone="confirm"
            />
          )}
          <ActionItem
            caption="Send it back to the sandbox to keep discussing."
            icon={ArrowDownToLineIcon}
            label="Discuss"
            onClick={() => actions.handleBringToSandbox(selectedNode)}
            tone="sandbox"
          />
          <ActionItem
            caption="Reject this candidate; it won't become a truth."
            disabled={actions.isMutating}
            icon={XIcon}
            label="Dismiss"
            onClick={() => actions.handleDismissCandidate(selectedNode)}
            tone="neutral"
          />
        </div>
      </>
    );
  }

  if (selectedNode.status === "idea") {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto" />
        <div className="flex shrink-0 flex-col divide-y divide-[var(--ir-border-default)]">
          <ActionItem
            caption="Promote this idea to a candidate, pending confirmation."
            disabled={actions.isMutating}
            icon={CircleDotIcon}
            label="Promote"
            onClick={() => actions.handlePromoteIdea(selectedNode)}
            primary
            tone="promote"
          />
          <ActionItem
            caption="Bring it back to the sandbox to explore."
            icon={ArrowDownToLineIcon}
            label="Discuss"
            onClick={() => actions.handleBringToSandbox(selectedNode)}
            tone="sandbox"
          />
          <ActionItem
            caption="Ignore this idea; stop surfacing it."
            disabled={actions.isMutating}
            icon={XIcon}
            label="Ignore"
            onClick={() => actions.handleDismissIdea(selectedNode)}
            tone="neutral"
          />
        </div>
      </>
    );
  }

  if (selectedNode.status === "superseded") {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto" />
        <div className="flex shrink-0 flex-col divide-y divide-[var(--ir-border-default)]">
          <ActionItem
            caption="Restore this superseded node."
            disabled
            icon={ArrowDownToLineIcon}
            label="Restore"
            tone="neutral"
          />
          <ActionItem
            caption="Bring it back to the sandbox to discuss."
            icon={ArrowDownToLineIcon}
            label="Discuss"
            onClick={() => actions.handleBringToSandbox(selectedNode)}
            tone="sandbox"
          />
        </div>
      </>
    );
  }

  // Fallback (e.g. dismissed): a single reference action.
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto" />
      <div className="flex shrink-0 flex-col divide-y divide-[var(--ir-border-default)]">
        <ActionItem
          caption="Bring this back to the sandbox to discuss."
          icon={ArrowDownToLineIcon}
          label="Discuss"
          onClick={() =>
            queueReferenceDraft(
              `> [${selectedNode.id}] ${selectedNode.title}\n> ${selectedNode.content ?? selectedNode.title}`
            )
          }
          tone="sandbox"
        />
      </div>
    </>
  );
}

export type IRDetailPaneProps = {
  actions: ReturnType<typeof useIRActions>;
  detail: IRDetail | undefined;
  selectedNode: IRNode | null;
};

/**
 * Must be rendered inside both `IRProvider` and `WorkspaceProvider` —
 * it reads `selectNode` and `queueReferenceDraft` from those contexts.
 */
export function IRDetailPane({
  actions,
  detail,
  selectedNode,
}: IRDetailPaneProps) {
  const { selectNode } = useIR();

  if (!selectedNode) {
    return (
      <div
        className="flex h-full flex-col justify-center px-4 text-sm text-[var(--ir-text-tertiary)]"
        data-testid="ir-detail-pane"
      >
        <p className="font-medium text-[var(--ir-text-primary)]">Detail</p>
        <p>Select an idea, candidate, IR node, or inline reference.</p>
      </div>
    );
  }

  return (
    // Column split kept in sync with TruthGraph above so Details|Actions aligns
    // with Overview|Chain into one continuous "+".
    <div
      className="grid h-full min-h-[220px] grid-cols-[minmax(0,1fr)_clamp(300px,30%,380px)] overflow-hidden"
      data-testid="ir-detail-pane"
    >
      {/* LEFT: detail content — aligned under the Overview column */}
      <div className="flex min-w-0 flex-col overflow-hidden border-r border-[var(--ir-border-default)]">
        <div className="flex items-start justify-between gap-2 border-b border-[var(--ir-border-default)] px-3 py-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--ir-text-secondary)]">
              {kindPresentation(selectedNode.kind, selectedNode.subtype).label}
            </p>
            <h3 className="mt-1 break-words text-base font-medium leading-[1.35] text-[var(--ir-text-primary)]">
              {selectedNode.title}
            </h3>
            <div className="mt-1">
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
                  onChange={(event) =>
                    actions.setKindChoice(event.target.value)
                  }
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
      </div>

      {/* RIGHT: action column (~38%). Supplemental content scrolls; the button
          footer stays pinned and visible (requirement: buttons don't scroll). */}
      <aside className="flex min-w-0 flex-col gap-2 overflow-hidden px-3 py-3">
        <ActionColumn
          actions={actions}
          detail={detail}
          selectedNode={selectedNode}
        />
      </aside>
    </div>
  );
}
