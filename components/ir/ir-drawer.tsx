"use client";

import { MessageSquareIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useLocale } from "@/components/i18n/locale-provider";
import { IRDetailPane } from "@/components/ir/ir-detail";
import { irNodeKey, useIR } from "@/components/ir/ir-provider";
import { kindPresentation } from "@/components/ir/kind-presentation";
import { useIRActions } from "@/components/ir/use-ir-actions";
import { Button } from "@/components/ui/button";
import type { IRDetail, IRNode } from "@/lib/ir/types";
import { getIRKindKey } from "@/lib/ir/types";
import { cn, fetcher } from "@/lib/utils";

const LOCALE_TAG: Record<string, string> = {
  en: "en-US",
  zh: "zh-CN",
  fr: "fr-FR",
};

// A candidate/idea row. The statement (title) is the focus; the type label is a
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

export function IRDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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
  const [tab, setTab] = useState<"candidates" | "ideas">("candidates");
  const cardRef = useRef<HTMLDivElement>(null);

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

  const candidatesTab = useMemo(
    () => [...candidates, ...unassignedCandidates],
    [candidates, unassignedCandidates]
  );
  const ideasTab = useMemo(
    () => [...ideas, ...unassignedIdeas],
    [ideas, unassignedIdeas]
  );
  const activeList = tab === "candidates" ? candidatesTab : ideasTab;

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
      <header className="flex items-center justify-between gap-2 border-b border-[var(--ir-border-default)] px-3 py-2.5">
        <div className="inline-flex rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] p-0.5 text-xs">
          <button
            className={cn(
              "rounded-md px-2.5 py-1 font-medium transition-colors",
              tab === "candidates"
                ? "bg-[var(--ir-bg-panel)] text-[var(--ir-text-primary)] shadow-sm"
                : "text-[var(--ir-text-secondary)] hover:text-[var(--ir-text-primary)]"
            )}
            onClick={() => setTab("candidates")}
            type="button"
          >
            Candidates{" "}
            <span className="text-[var(--ir-text-tertiary)]">
              {candidatesTab.length}
            </span>
          </button>
          <button
            className={cn(
              "rounded-md px-2.5 py-1 font-medium transition-colors",
              tab === "ideas"
                ? "bg-[var(--ir-bg-panel)] text-[var(--ir-text-primary)] shadow-sm"
                : "text-[var(--ir-text-secondary)] hover:text-[var(--ir-text-primary)]"
            )}
            onClick={() => setTab("ideas")}
            type="button"
          >
            Ideas{" "}
            <span className="text-[var(--ir-text-tertiary)]">
              {ideasTab.length}
            </span>
          </button>
        </div>
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
        <div className="py-1" data-testid={`ir-${tab}-zone`}>
          {activeList.length === 0 && !isLoading ? (
            <p className="px-3.5 py-6 text-center text-sm text-[var(--ir-text-tertiary)]">
              {tab === "candidates"
                ? "No pending candidates."
                : "No ideas yet."}
            </p>
          ) : null}
          {activeList.slice(0, tab === "ideas" ? 12 : 50).map((node) => (
            <NodeButton
              key={node.id}
              node={node}
              onSelect={selectNode}
              selected={selectedNodeId === node.id}
            />
          ))}
          {tab === "ideas" && ideasTab.length > 12 ? (
            <p className="px-3.5 py-2 text-xs text-[var(--ir-text-tertiary)]">
              + {ideasTab.length - 12} more
            </p>
          ) : null}
        </div>
      </div>

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
