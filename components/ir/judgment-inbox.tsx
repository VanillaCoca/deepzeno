"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { InboxIcon, ShieldAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR, { type KeyedMutator, useSWRConfig } from "swr";
import { useLocale } from "@/components/i18n/locale-provider";
import { IRDetailPane } from "@/components/ir/ir-detail";
import { irNodeKey } from "@/components/ir/ir-provider";
import { kindPresentation } from "@/components/ir/kind-presentation";
import { Redline } from "@/components/ir/redline";
import { useIRActions } from "@/components/ir/use-ir-actions";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { InboxTier, type InboxItem } from "@/lib/ir/inbox-core";
import type { IRDetail, IRNode } from "@/lib/ir/types";
import { cn, fetcher } from "@/lib/utils";

type InboxResponse = { items: InboxItem[]; not_migrated?: boolean };

export function inboxKey(projectId: string | null) {
  return projectId
    ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/ir/inbox?project_id=${projectId}`
    : null;
}

// Shared by the view and the header badge, so both read the same cache and the
// badge tracks the queue exactly (PRD JI-09).
export function useInbox(projectId: string | null) {
  return useSWR<InboxResponse>(inboxKey(projectId), fetcher, {
    revalidateOnFocus: false,
  });
}

function BlastMeter({ item }: { item: InboxItem }) {
  const { t } = useLocale();
  const isReshape = item.tier === InboxTier.reshape;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
        isReshape
          ? "border-[var(--ir-warning-stripe)] text-[var(--ir-warning-fg)]"
          : "border-[var(--ir-border-default)] text-[var(--ir-text-tertiary)]"
      )}
      title={isReshape ? t("inbox.tierReshape") : t("inbox.tierAdditive")}
    >
      {isReshape ? <ShieldAlertIcon className="size-3" /> : null}
      {item.blastRadius}
    </span>
  );
}

function InboxRow({
  item,
  selected,
  onSelect,
}: {
  item: InboxItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useLocale();
  const { topics } = useWorkspace();
  const node = item.node;
  const topicLabel = node.topicId
    ? (topics.find((topic) => topic.id === node.topicId)?.label ?? null)
    : null;

  return (
    <button
      className={cn(
        "flex w-full flex-col gap-1.5 border-[var(--ir-border-default)] border-b px-3 py-2.5 text-left transition-colors",
        selected ? "bg-[var(--ir-bg-hover)]" : "hover:bg-[var(--ir-bg-hover)]"
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--ir-text-tertiary)]">
          {kindPresentation(node.kind, node.subtype).label}
        </span>
        {node.sourceLayer ? (
          <span className="rounded border border-[var(--ir-border-default)] px-1 py-px text-[9px] lowercase text-[var(--ir-text-tertiary)]">
            {node.sourceLayer}
          </span>
        ) : null}
        <span className="ml-auto">
          <BlastMeter item={item} />
        </span>
      </div>
      <span className="line-clamp-2 text-[13px] leading-snug text-[var(--ir-text-primary)]">
        {node.title}
      </span>
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--ir-text-tertiary)]">
        <span>{topicLabel ?? t("inbox.unassigned")}</span>
        <span aria-hidden="true">·</span>
        <span>{formatDistanceToNowStrict(new Date(node.createdAt))}</span>
      </div>
    </button>
  );
}

function InboxRulingContext({
  item,
  targetNode,
}: {
  item: InboxItem;
  targetNode: IRNode | null;
}) {
  const { t } = useLocale();
  const overflow = item.blastRadius - item.topDownstream.length;

  return (
    <div className="shrink-0 space-y-3 border-[var(--ir-border-default)] border-b px-4 py-3">
      <section className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ir-text-tertiary)]">
          {t("inbox.blastRadius")}
        </p>
        {item.blastRadius === 0 ? (
          <p className="text-[13px] text-[var(--ir-text-secondary)]">
            {t("inbox.blastRadiusNone")}
          </p>
        ) : (
          <div className="space-y-1 text-[13px] text-[var(--ir-text-secondary)]">
            <p>{t("inbox.blastRadiusSummary", { count: item.blastRadius })}:</p>
            <ul className="space-y-0.5">
              {item.topDownstream.map((downstream) => (
                <li className="flex items-baseline gap-1.5" key={downstream.id}>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--ir-text-tertiary)]">
                    {downstream.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--ir-text-primary)]">
                    {downstream.title}
                  </span>
                  <span className="shrink-0 text-[10px] lowercase text-[var(--ir-text-tertiary)]">
                    {downstream.relation}
                  </span>
                </li>
              ))}
            </ul>
            {overflow > 0 ? (
              <p className="text-[11px] text-[var(--ir-text-tertiary)]">
                {t("inbox.andMore", { count: overflow })}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {item.isSupersede && targetNode ? (
        <section className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ir-text-tertiary)]">
            {t("inbox.redline")}
          </p>
          <Redline
            newText={item.node.content ?? item.node.title}
            oldText={targetNode.content ?? targetNode.title}
          />
        </section>
      ) : null}
    </div>
  );
}

function InboxRulingPanel({ item }: { item: InboxItem }) {
  const node = item.node;
  const { activeProjectId } = useWorkspace();
  const { mutate } = useSWRConfig();
  const { data: detail, mutate: mutateDetail } = useSWR<IRDetail>(
    irNodeKey(node.id),
    fetcher,
    { revalidateOnFocus: false }
  );

  // use-ir-actions calls this (with no args) after a ruling; we revalidate the
  // inbox alongside the node detail so the ruled node leaves the queue and the
  // badge drops (JI-04/07/09). A no-arg mutator is assignable to KeyedMutator.
  const mutateDetailAndInbox: KeyedMutator<IRDetail> = () => {
    void mutate(inboxKey(activeProjectId));
    return mutateDetail();
  };

  const actions = useIRActions(node, mutateDetailAndInbox);

  const targetNode =
    item.reshapeTargetId && detail
      ? (detail.relatedNodes.find(
          (related) => related.id === item.reshapeTargetId
        ) ?? null)
      : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <InboxRulingContext item={item} targetNode={targetNode} />
      <div className="min-h-0 flex-1">
        <IRDetailPane actions={actions} detail={detail} selectedNode={node} />
      </div>
    </div>
  );
}

export function JudgmentInbox() {
  const { t } = useLocale();
  const { activeProjectId } = useWorkspace();
  const { data, isLoading } = useInbox(activeProjectId);
  const items = data?.items ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep the selection valid: seed the first item, and clear when the current
  // one leaves the queue after a ruling.
  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!(selectedId && items.some((item) => item.node.id === selectedId))) {
      setSelectedId(items[0].node.id);
    }
  }, [items, selectedId]);

  const selectedItem =
    items.find((item) => item.node.id === selectedId) ?? null;

  if (data?.not_migrated) {
    return (
      <div className="flex h-full items-center justify-center pt-16 text-sm text-[var(--ir-text-tertiary)]">
        {t("inbox.notMigrated")}
      </div>
    );
  }

  if (!(isLoading || items.length > 0)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 pt-16 text-center">
        <InboxIcon className="size-7 text-[var(--ir-text-tertiary)]" />
        <p className="font-medium text-[var(--ir-text-primary)]">
          {t("inbox.empty")}
        </p>
        <p className="text-sm text-[var(--ir-text-tertiary)]">
          {t("inbox.emptyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full pt-16" data-testid="judgment-inbox">
      <aside className="flex w-[340px] shrink-0 flex-col border-[var(--ir-border-default)] border-r">
        <div className="flex items-center justify-between border-[var(--ir-border-default)] border-b px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ir-text-primary)]">
            <InboxIcon className="size-4" />
            {t("inbox.title")}
          </span>
          <span className="text-[11px] text-[var(--ir-text-tertiary)]">
            {t("inbox.queueCount", { count: items.length })}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.map((item) => (
            <InboxRow
              item={item}
              key={item.node.id}
              onSelect={() => setSelectedId(item.node.id)}
              selected={item.node.id === selectedId}
            />
          ))}
        </div>
      </aside>

      <div className="min-h-0 flex-1">
        {selectedItem ? (
          <InboxRulingPanel item={selectedItem} key={selectedItem.node.id} />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ir-text-tertiary)]">
            {t("inbox.selectPrompt")}
          </div>
        )}
      </div>
    </div>
  );
}
