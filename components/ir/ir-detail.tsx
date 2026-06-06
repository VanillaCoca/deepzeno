"use client";

import {
  ArrowDownToLineIcon,
  CheckIcon,
  CircleDotIcon,
  MessageSquareTextIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import { useIR } from "@/components/ir/ir-provider";
import type { useIRActions } from "@/components/ir/use-ir-actions";
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
import type { IRDetail, IRNode } from "@/lib/ir/types";
import { getIRTypeLabel } from "@/lib/ir/types";

export function StatusBadge({ status }: { status: IRNode["status"] }) {
  return (
    <span className="text-[11px] lowercase text-[var(--ir-text-secondary)]">
      {status}
    </span>
  );
}

export function getNodeTypeLabel(node: IRNode) {
  if (node.kind === "plan") {
    return node.subtype ?? "plan";
  }

  if (node.kind === "unclassified") {
    return "?";
  }

  return node.kind.replace("_", " ");
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

export type IRDetailPaneProps = {
  actions: ReturnType<typeof useIRActions>;
  detail: IRDetail | undefined;
  selectedNode: IRNode | null;
};

/**
 * Must be rendered inside both `IRProvider` and `WorkspaceProvider` —
 * it reads `selectNode` and `queueReferenceDraft` directly from those contexts.
 */
export function IRDetailPane({
  actions,
  detail,
  selectedNode,
}: IRDetailPaneProps) {
  const { selectNode } = useIR();
  const { queueReferenceDraft } = useWorkspace();

  return (
    <>
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
                    (edge) =>
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
              onChange={(event) =>
                actions.setDraftRationale(event.target.value)
              }
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
    </>
  );
}
