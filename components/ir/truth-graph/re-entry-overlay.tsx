"use client";

// Re-entry overlay — 修订案 №4 §2.
//
// Three sections, fixed order, no exceptions: what you said you'd do next →
// where you're stuck → what changed. The order is not a layout preference; it
// is what task-resumption research finds people actually reach for, and §4.2
// lists section composition and order among the things the agent may never
// vary. Only the items INSIDE a section are chosen per visit.
//
// Geometry contract (§2.1): this is an absolutely-positioned overlay. It floats
// above the canvas and never participates in layout, so lanes and nodes sit at
// exactly the same coordinates whether it is open, closed, short or tall. A
// variable-height banner would move every node by a different amount on every
// visit — the spatial-memory damage v1 §1.1 forbids and the single most
// documented failure of adaptive UI. If this component ever grows, it scrolls
// internally; it must never push.
//
// Deliberately absent: any bulk-confirm control (§2.3, Inbox K3/N2). Every row
// here is navigational. The overlay reports; it never collects rulings — a
// screen designed to be skimmed is the worst possible place to accept them.

import { ChevronRightIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";
import type {
  ChangedItem,
  ReEntryOverlay as ReEntryOverlayModel,
} from "@/lib/workspace/re-entry-overlay-core";

export type ReEntryOverlayProps = {
  /**
   * Model from `buildReEntryOverlay`. Sections are already ordered, truncated
   * and counted there; this component renders what it is given and never
   * re-sorts or re-slices — otherwise the rules would live in two places and
   * drift.
   */
  overlay: ReEntryOverlayModel;
  /**
   * §2.4 narrative variant (≥14d). Supplied by the caller because it is the one
   * place a model may write free prose — and it must arrive with its citations
   * already attached. Ignored unless `overlay.narrativeRequested`.
   */
  narrative?: ReactNode;
  onDismiss: () => void;
  onOpenInbox: () => void;
  onSelectNode: (nodeId: string) => void;
};

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--z-text-3)]">
      {children}
    </p>
  );
}

// The remainder line. It exists so a truncated list can never read as a
// complete one — §2.3 bans silent truncation, mirroring Watchtower N3. The
// core type carries `hiddenCount` precisely so this cannot be forgotten.
function MoreLine({ label }: { label: string }) {
  return <p className="px-2 pt-1 text-[11px] text-[var(--z-text-3)]">{label}</p>;
}

const CHANGED_TONE: Record<ChangedItem["kind"], string> = {
  superseded_truth: "text-[var(--z-rejected)]",
  invalidated_assumption: "text-[var(--z-rejected)]",
  watchtower_alert: "text-[var(--z-attention-text)]",
  new_truth: "text-[var(--z-confirmed)]",
  dismissed_candidate: "text-[var(--z-text-3)]",
};

export function ReEntryOverlay({
  overlay,
  narrative,
  onDismiss,
  onOpenInbox,
  onSelectNode,
}: ReEntryOverlayProps) {
  const { t } = useLocale();

  return (
    <aside
      aria-label={t("reEntry.overlay.aria")}
      className="absolute top-[var(--z-card-inset)] right-[var(--z-card-inset)] left-[var(--z-card-inset)] z-20 flex max-h-[min(70%,520px)] flex-col overflow-hidden rounded-[var(--z-card-radius)] border border-[var(--z-topic-border)] bg-[var(--z-card-bg)] shadow-[var(--z-card-shadow)]"
      data-testid="re-entry-overlay"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--z-topic-border)] px-3 py-2">
        <span className="text-[13px] font-medium text-[var(--z-text)]">
          {t("reEntry.title")}
        </span>
        <button
          aria-label={t("reEntry.dismiss")}
          className="rounded-md p-1 text-[var(--z-text-3)] hover:bg-[var(--z-node-fill)] hover:text-[var(--z-text-2)]"
          data-testid="re-entry-overlay-dismiss"
          onClick={onDismiss}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* Internal scroll, never external growth — see the geometry contract. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {overlay.narrativeRequested && narrative ? (
          <section data-testid="re-entry-overlay-narrative">
            <SectionHeading>{t("reEntry.overlay.narrative")}</SectionHeading>
            <div className="px-2 text-sm leading-[1.7] text-[var(--z-text-2)]">
              {narrative}
            </div>
          </section>
        ) : null}

        {overlay.sections.map((section) => {
          if (section.id === "unfinished_intent") {
            // Verbatim, and only when it exists. §2.3 forbids inferring an
            // intent the user never recorded: a wrong "you were about to…" is
            // the single most expensive sentence this product could say.
            return (
              <section
                data-testid="re-entry-overlay-intent"
                key={section.id}
              >
                <SectionHeading>{t("reEntry.overlay.intent")}</SectionHeading>
                <p className="px-2 text-sm leading-relaxed text-[var(--z-text)]">
                  {section.intent.text}
                </p>
                <p className="px-2 pt-1 text-[11px] text-[var(--z-text-3)]">
                  {t(`reEntry.overlay.intent.${section.intent.source}`)}
                </p>
              </section>
            );
          }

          if (section.id === "blocked") {
            return (
              <section data-testid="re-entry-overlay-blocked" key={section.id}>
                <SectionHeading>{t("reEntry.overlay.blocked")}</SectionHeading>
                <ul className="list-none space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.node.id}>
                      <button
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--z-node-fill)]"
                        data-testid={`re-entry-overlay-blocked-${item.node.id}`}
                        onClick={() => onSelectNode(item.node.id)}
                        title={item.node.title}
                        type="button"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-[var(--z-text)]">
                          {item.node.title}
                        </span>
                        {/* Consequence, stated plainly. §4.4: the way to
                            prompt someone is to make the cost of the gap
                            visible — not to pop a dialog. */}
                        {item.blastRadius > 0 ? (
                          <span className="shrink-0 text-[11px] text-[var(--z-attention-text)]">
                            {t("reEntry.overlay.blockedDownstream", {
                              count: item.blastRadius,
                            })}
                          </span>
                        ) : null}
                        <ChevronRightIcon className="size-3.5 shrink-0 text-[var(--z-text-3)] opacity-60" />
                      </button>
                    </li>
                  ))}
                </ul>
                {section.hiddenCount > 0 ? (
                  <MoreLine
                    label={t("reEntry.overlay.blockedMore", {
                      count: section.hiddenCount,
                    })}
                  />
                ) : null}
                {/* One door to the queue. The overlay never becomes a second
                    inbox — two lists of the same pending set would eventually
                    disagree, and the user would have to work out which lied. */}
                <button
                  className="mt-1 rounded-md px-2 py-1 text-[12px] text-[var(--z-text-2)] hover:bg-[var(--z-node-fill)] hover:text-[var(--z-text)]"
                  data-testid="re-entry-overlay-open-inbox"
                  onClick={onOpenInbox}
                  type="button"
                >
                  {t("reEntry.overlay.seeAll", { count: section.queueTotal })}
                </button>
              </section>
            );
          }

          return (
            <section data-testid="re-entry-overlay-changed" key={section.id}>
              <SectionHeading>{t("reEntry.overlay.changed")}</SectionHeading>
              <ul className="list-none space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--z-node-fill)]"
                      data-testid={`re-entry-overlay-changed-${item.id}`}
                      onClick={() => onSelectNode(item.id)}
                      title={item.title}
                      type="button"
                    >
                      {/* Kind is carried as a word, not only as colour —
                          v1 §4.7 colour-blind redundancy. */}
                      <span
                        className={cn(
                          "shrink-0 text-[11px] font-medium",
                          CHANGED_TONE[item.kind]
                        )}
                      >
                        {t(`reEntry.overlay.kind.${item.kind}`)}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm text-[var(--z-text)]",
                          (item.kind === "superseded_truth" ||
                            item.kind === "dismissed_candidate") &&
                            "line-through"
                        )}
                      >
                        {item.title}
                      </span>
                      <ChevronRightIcon className="size-3.5 shrink-0 text-[var(--z-text-3)] opacity-60" />
                    </button>
                  </li>
                ))}
              </ul>
              {section.hiddenCount > 0 ? (
                <MoreLine
                  label={t("reEntry.overlay.changedMore", {
                    count: section.hiddenCount,
                  })}
                />
              ) : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
