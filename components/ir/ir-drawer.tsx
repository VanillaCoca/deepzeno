"use client";

import { ArrowRightIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import { useLocale } from "@/components/i18n/locale-provider";
import { IRDetailPane } from "@/components/ir/ir-detail";
import { irNodeKey, useIR } from "@/components/ir/ir-provider";
import { kindPresentation } from "@/components/ir/kind-presentation";
import { useIRActions } from "@/components/ir/use-ir-actions";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { IRDetail, IRNode } from "@/lib/ir/types";
import { getIRKindKey } from "@/lib/ir/types";
import { cn, fetcher } from "@/lib/utils";

const LOCALE_TAG: Record<string, string> = {
  en: "en-US",
  zh: "zh-CN",
  fr: "fr-FR",
};

// An idea row. The statement (title) is the focus; the type label is a
// localized pill; provenance ("from conversation · date") replaces the internal
// extraction note the list used to surface. Full content/rationale lives in the
// detail pane on click, so the list stays scannable, not bloated.
function NodeButton({
  node,
  selected,
  onSelect,
}: {
  node: IRNode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { t, locale } = useLocale();
  const { color } = kindPresentation(node.kind, node.subtype);
  const label = t(getIRKindKey(node.kind, node.subtype));
  const fromChat = Boolean(node.sourceChatId);
  const dateLabel = fromChat
    ? new Date(node.createdAt).toLocaleDateString(
        LOCALE_TAG[locale] ?? "en-US",
        { day: "numeric", month: "short" }
      )
    : null;

  return (
    <button
      className={cn(
        "relative block w-full border-b border-[var(--ir-border-default)] px-3.5 py-3 text-left transition-colors hover:bg-[var(--ir-bg-hover)]",
        selected &&
          "bg-[var(--ir-bg-hover)] before:absolute before:top-0 before:left-0 before:h-full before:w-0.5 before:bg-[var(--ir-accent-blue)]"
      )}
      onClick={() => onSelect(node.id)}
      title={node.title}
      type="button"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--ir-text-secondary)]">
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </span>
      <div
        className={cn(
          "mt-2 font-medium text-[13.5px] text-[var(--ir-text-primary)] leading-[1.45]",
          node.status === "superseded" &&
            "text-[var(--ir-text-tertiary)] line-through",
          node.status === "idea" &&
            "font-normal text-[var(--ir-text-secondary)]"
        )}
      >
        {node.title}
      </div>
      {fromChat ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--ir-text-tertiary)]">
          <MessageSquareIcon className="size-3 shrink-0" />
          <span>
            {t("ir.from.conversation")}
            {dateLabel ? ` · ${dateLabel}` : ""}
          </span>
        </div>
      ) : null}
    </button>
  );
}

/**
 * The idea pool.
 *
 * It used to be a two-tab drawer, Candidates alongside Ideas. That put a
 * confirm button on the same screen as the judgment inbox's — two entrances to
 * the one irreversible act this product treats as scarce, and the drawer's was
 * the cheaper one: a flat list, no tier, no blast radius, no redline. Two
 * pending counts on one screen also meant neither queue could promise a bottom.
 * So candidates left, and what stays here is the half that was never in the
 * queue to begin with: ideas, which by PRD D0-NG4 never ask for a ruling.
 *
 * That makes this a browsing surface rather than a work queue, and the layout
 * follows — no cap on the list, no count competing with the nav badge, and a
 * signpost at the foot for the one question the split creates: an idea you
 * promoted is not here any more, so where did it go?
 */
export function IRDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { ideas, isLoading, selectNode, selectedNodeId, unassignedIdeas } =
    useIR();
  const { requestView } = useWorkspace();
  const { t } = useLocale();
  const cardRef = useRef<HTMLDivElement>(null);

  const { data: detail, mutate: mutateDetail } = useSWR<IRDetail>(
    irNodeKey(selectedNodeId),
    fetcher,
    { revalidateOnFocus: false }
  );

  const ideaPool = useMemo(
    () => [...ideas, ...unassignedIdeas],
    [ideas, unassignedIdeas]
  );

  // Scoped to what this drawer lists, and nothing else. A candidate selected on
  // the truth-graph stage shares `selectedNodeId`, but its detail — and its
  // confirm button — belong to that stage, not to a pool the candidate left.
  const selectedDrawerNode =
    ideaPool.find((node) => node.id === selectedNodeId) ?? null;
  const actions = useIRActions(selectedDrawerNode, mutateDetail);

  // Outside-click / Escape closes the floating card (non-modal, like a popover).
  // The trigger pill is exempt so its own toggle handler isn't double-fired.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target || cardRef.current?.contains(target)) {
        return;
      }
      if (target.closest('[data-testid="ir-drawer-trigger"]')) {
        return;
      }
      onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fade-in-0 zoom-in-95 fixed top-14 right-3 z-40 flex max-h-[calc(100dvh-4.5rem)] w-[340px] max-w-[calc(100vw-1.5rem)] origin-top-right animate-in flex-col overflow-hidden rounded-2xl border border-[var(--ir-border-strong)] bg-[var(--ir-bg-panel)] shadow-xl duration-150"
      data-testid="ir-drawer"
      ref={cardRef}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--ir-border-default)] px-3.5 py-2.5">
        <h2 className="font-medium text-[13px] text-[var(--ir-text-primary)]">
          {t("ir.drawer.title")}
          <span className="ml-1.5 font-normal text-[var(--ir-text-tertiary)]">
            {ideaPool.length}
          </span>
        </h2>
        <Button
          aria-label={t("ir.drawer.close")}
          className="rounded border border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
          onClick={onClose}
          size="icon-sm"
          variant="outline"
        >
          <XIcon className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="py-1" data-testid="ir-ideas-zone">
          {ideaPool.length === 0 && !isLoading ? (
            <div className="px-3.5 py-6 text-center">
              <p className="text-sm text-[var(--ir-text-tertiary)]">
                {t("ir.drawer.empty")}
              </p>
              {/* Nobody fills this pool by hand, so an empty one is a question
                  ("am I supposed to do something?") unless it says who does. */}
              <p className="mt-1.5 text-[var(--ir-text-tertiary)] text-xs leading-relaxed">
                {t("ir.drawer.emptyHint")}
              </p>
            </div>
          ) : null}
          {/* Uncapped. The old list stopped at 12 with a "+ N more" line that
              led nowhere — a dead end on data already in memory. */}
          {ideaPool.map((node) => (
            <NodeButton
              key={node.id}
              node={node}
              onSelect={selectNode}
              selected={selectedNodeId === node.id}
            />
          ))}
        </div>
      </div>

      {/* Deliberately carries no count. The nav badge is the single "you owe N
          decisions" number; a second one here would be the very thing the tab
          removal exists to kill. This is a direction, not a notification. */}
      <button
        className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--ir-border-default)] px-3.5 py-2.5 text-left text-[var(--ir-text-secondary)] text-xs transition-colors hover:bg-[var(--ir-bg-hover)] hover:text-[var(--ir-text-primary)]"
        onClick={() => {
          requestView("inbox");
          onClose();
        }}
        type="button"
      >
        {t("ir.drawer.toInbox")}
        <ArrowRightIcon className="size-3.5 shrink-0" />
      </button>

      {selectedDrawerNode ? (
        <div className="max-h-[45%] min-h-[200px] shrink-0 overflow-auto border-t border-[var(--ir-border-default)]">
          <IRDetailPane
            actions={actions}
            detail={detail}
            selectedNode={selectedDrawerNode}
          />
        </div>
      ) : null}
    </div>
  );
}
