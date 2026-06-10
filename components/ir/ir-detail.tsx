"use client";

import {
  ArrowDownToLineIcon,
  CheckIcon,
  CircleDotIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { useIR } from "@/components/ir/ir-provider";
import { kindPresentation } from "@/components/ir/kind-presentation";
import type { useIRActions } from "@/components/ir/use-ir-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  loading,
  onClick,
  primary,
  tone,
}: {
  caption: string;
  disabled?: boolean;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  loading?: boolean;
  onClick?: () => void;
  primary?: boolean;
  tone: ActionRole;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--ir-text-tertiary)]">
        {caption}
      </p>
      <Button
        className={cn(
          "min-w-[104px] justify-center",
          primary && "font-semibold"
        )}
        disabled={disabled || loading}
        onClick={onClick}
        size="sm"
        variant={actionVariant(tone, primary)}
      >
        {loading ? (
          <Spinner className={cn("size-4", ACTION_ICON[tone])} />
        ) : (
          <Icon className={cn("size-4", ACTION_ICON[tone])} />
        )}
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
  const { t } = useLocale();
  const relatedById = new Map(
    detail.relatedNodes.map((node) => [node.id, node])
  );

  if (detail.edges.length === 0) {
    return (
      <p className="text-sm text-[var(--ir-text-tertiary)]">
        {t("detail.noRelations")}
      </p>
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
              {isOutgoing
                ? edge.relation
                : `${edge.relation} ${t("detail.relationBySuffix")}`}
            </span>
            <span className="min-w-0 flex-1 text-[var(--ir-text-primary)]">
              {targetId} · {related?.title ?? t("detail.unknown")}
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
  const { t } = useLocale();
  const { queueReferenceDraft } = useWorkspace();
  const confirmability = selectedNode.confirmability;
  // Forward-compatible default: until Lixian produces the field, treat absent
  // as confirmable (contract zeno-confirmability-contract.md §4).
  const needsDiscussion = confirmability?.status === "needs_discussion";

  if (selectedNode.status === "active") {
    // Confirmed truths only re-open for re-evaluation. No explanatory intro —
    // just a single button pinned to the bottom-right of the panel.
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto" />
        <div className="flex shrink-0 justify-end">
          <Button
            className="min-w-[104px] justify-center font-semibold"
            onClick={() => actions.handleBringToSandbox(selectedNode)}
            size="sm"
            variant="secondary"
          >
            <ArrowDownToLineIcon
              className={cn("size-4", ACTION_ICON.sandbox)}
            />
            {t("detail.reEvaluate")}
          </Button>
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
              {t("detail.supersedeWarning")}
            </div>
          ) : null}
          {detail?.edges.some(
            (edge) =>
              edge.relation === "contradicts" &&
              (edge.fromNode === selectedNode.id ||
                edge.toNode === selectedNode.id)
          ) ? (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--ir-warning-stripe)] bg-[var(--ir-warning-bg)] px-2 py-2 text-xs text-[var(--ir-warning-fg)]">
              <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              {t("detail.contradictsWarning")}
            </div>
          ) : null}
          {selectedNode.topicId ? null : (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 py-2">
              <p className="text-xs font-medium text-[var(--ir-text-primary)]">
                {t("detail.assignJudgment")}
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
                placeholder={t("detail.newJudgmentPlaceholder")}
                value={actions.newTopicLabel}
              />
            </div>
          )}
          {needsDiscussion ? (
            <div className="rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 py-2 text-xs text-[var(--ir-text-secondary)]">
              {t("detail.needsDiscussion")}
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
              caption={t("detail.confirmCaption")}
              disabled={actions.isMutating}
              icon={CheckIcon}
              label={t("detail.confirm")}
              loading={actions.pendingAction === "confirm"}
              onClick={() => actions.handleConfirmNode(selectedNode)}
              primary
              tone="confirm"
            />
          )}
          <ActionItem
            caption={t("detail.discussCandidateCaption")}
            icon={ArrowDownToLineIcon}
            label={t("detail.discuss")}
            onClick={() => actions.handleBringToSandbox(selectedNode)}
            tone="sandbox"
          />
          <ActionItem
            caption={t("detail.dismissCaption")}
            disabled={actions.isMutating}
            icon={XIcon}
            label={t("detail.dismiss")}
            loading={actions.pendingAction === "dismiss"}
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
            caption={t("detail.promoteCaption")}
            disabled={actions.isMutating}
            icon={CircleDotIcon}
            label={t("detail.promote")}
            loading={actions.pendingAction === "promote"}
            onClick={() => actions.handlePromoteIdea(selectedNode)}
            primary
            tone="promote"
          />
          <ActionItem
            caption={t("detail.discussIdeaCaption")}
            icon={ArrowDownToLineIcon}
            label={t("detail.discuss")}
            onClick={() => actions.handleBringToSandbox(selectedNode)}
            tone="sandbox"
          />
          <ActionItem
            caption={t("detail.ignoreCaption")}
            disabled={actions.isMutating}
            icon={XIcon}
            label={t("detail.ignore")}
            loading={actions.pendingAction === "dismiss"}
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
            caption={t("detail.restoreCaption")}
            disabled
            icon={ArrowDownToLineIcon}
            label={t("detail.restore")}
            tone="neutral"
          />
          <ActionItem
            caption={t("detail.discussSupersededCaption")}
            icon={ArrowDownToLineIcon}
            label={t("detail.discuss")}
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
          caption={t("detail.discussFallbackCaption")}
          icon={ArrowDownToLineIcon}
          label={t("detail.discuss")}
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
  subNodes?: IRNode[];
};

/**
 * Must be rendered inside both `IRProvider` and `WorkspaceProvider` —
 * it reads `selectNode` and `queueReferenceDraft` from those contexts.
 */
export function IRDetailPane({
  actions,
  detail,
  selectedNode,
  subNodes = [],
}: IRDetailPaneProps) {
  const { t } = useLocale();
  const { selectNode } = useIR();

  if (!selectedNode) {
    return (
      <div
        className="flex h-full flex-col justify-center px-4 text-sm text-[var(--ir-text-tertiary)]"
        data-testid="ir-detail-pane"
      >
        <p className="font-medium text-[var(--ir-text-primary)]">
          {t("detail.detail")}
        </p>
        <p>{t("detail.emptySelection")}</p>
      </div>
    );
  }

  return (
    // Portrait card (right column of the stage): a shared header, a generously
    // spaced single-column reading body, and an action footer whose buttons stay
    // pinned to the bottom. Typography follows Apple's reading guidance —
    // comfortable line-height (~1.6), a narrow measure, and a clear type
    // hierarchy (small all-caps eyebrow labels over larger calm body text).
    <div
      className="flex h-full min-h-[220px] flex-col overflow-hidden"
      data-testid="ir-detail-pane"
    >
      {/* Shared header — a compact meta row (kind · status) over the title. */}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--ir-border-default)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--ir-text-tertiary)]">
            <span>
              {kindPresentation(selectedNode.kind, selectedNode.subtype).label}
            </span>
            <span aria-hidden="true">·</span>
            <StatusBadge status={selectedNode.status} />
          </div>
          <h3 className="mt-1 break-words text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-[var(--ir-text-primary)]">
            {selectedNode.title}
          </h3>
        </div>
        <Button
          aria-label={t("detail.closeDetail")}
          className="shrink-0 rounded border border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
          onClick={() => selectNode(null)}
          size="icon-sm"
          variant="outline"
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* Reading body — scrolls; sections separated by a roomy vertical rhythm */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ir-text-tertiary)]">
            {t("detail.rationale")}
          </p>
          <p className="whitespace-pre-wrap text-[14px] leading-[1.6] text-[var(--ir-text-primary)]">
            {selectedNode.rationale ||
              selectedNode.content ||
              selectedNode.title}
          </p>
        </section>

        <section className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ir-text-tertiary)]">
            {t("detail.relations")}
          </p>
          {detail ? (
            <DetailRelationList detail={detail} onSelect={selectNode} />
          ) : (
            <p className="text-[13px] text-[var(--ir-text-tertiary)]">
              {t("detail.loading")}
            </p>
          )}
        </section>

        {subNodes.length > 0 ? (
          <section className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ir-text-tertiary)]">
              {t("detail.subNodes")}
            </p>
            <div>
              {subNodes.map((sub) => (
                <button
                  className="flex w-full items-center gap-2 border-b border-[var(--ir-border-default)] py-2.5 text-left text-[14px] leading-[1.45] last:border-b-0 hover:bg-[var(--ir-bg-hover)]"
                  key={sub.id}
                  onClick={() => selectNode(sub.id)}
                  type="button"
                >
                  <span className="shrink-0 text-[11px] lowercase text-[var(--ir-text-tertiary)]">
                    {sub.id}
                  </span>
                  <span className="min-w-0 flex-1 text-[var(--ir-text-primary)]">
                    {sub.title}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ir-text-tertiary)]">
            {t("detail.source")}
          </p>
          <p className="text-[13px] leading-[1.55] text-[var(--ir-text-secondary)]">
            {selectedNode.sourceLayer ?? t("detail.manual")} ·{" "}
            {new Date(selectedNode.createdAt).toLocaleString()}
          </p>
        </section>

        {selectedNode.kind === "unclassified" ? (
          <section className="space-y-2 rounded-lg border border-[var(--ir-warning-stripe)] bg-[var(--ir-warning-bg)] p-3">
            <p className="text-xs font-semibold text-[var(--ir-warning-fg)]">
              {t("detail.kindUnclassified")}
            </p>
            <div className="flex gap-2">
              <select
                className="h-8 min-w-0 flex-1 rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 text-xs"
                onChange={(event) => actions.setKindChoice(event.target.value)}
                value={actions.kindChoice}
              >
                <option value="plan:decision">
                  {t("detail.kindPlanDecision")}
                </option>
                <option value="plan:task">{t("detail.kindPlanTask")}</option>
                <option value="plan:milestone">
                  {t("detail.kindPlanMilestone")}
                </option>
                <option value="goal:_">{t("detail.kindGoal")}</option>
                <option value="constraint:_">
                  {t("detail.kindConstraint")}
                </option>
                <option value="open_question:_">
                  {t("detail.kindOpenQuestion")}
                </option>
                <option value="hypothesis:_">
                  {t("detail.kindHypothesis")}
                </option>
                <option value="principle:_">{t("detail.kindPrinciple")}</option>
                <option value="rejection:_">{t("detail.kindRejection")}</option>
              </select>
              <Button
                className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                disabled={actions.isMutating}
                onClick={() => actions.handleReclassify(selectedNode)}
                size="sm"
                variant="outline"
              >
                {t("detail.use")}
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      {/* Action footer — supplemental content scrolls; the buttons stay pinned
          to the bottom (rules: the action button is always anchored below). */}
      <div className="flex max-h-[58%] shrink-0 flex-col border-t border-[var(--ir-border-default)] px-4 py-3">
        <ActionColumn
          actions={actions}
          detail={detail}
          selectedNode={selectedNode}
        />
      </div>
    </div>
  );
}
