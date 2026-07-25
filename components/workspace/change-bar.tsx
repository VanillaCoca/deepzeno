"use client";

import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { postJSON } from "@/components/ir/use-ir-actions";
import { Button } from "@/components/ui/button";
import type { WorkspaceView } from "@/components/workspace/workspace-header";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { fetcher } from "@/lib/utils";
import {
  countReEntryNeedsReview,
  RE_ENTRY_FULL_THRESHOLD_SECONDS,
  type ReEntryCategory,
  type ReEntryCounts,
  type ReEntryItem,
  selectReEntryHeadline,
  shouldShowReEntry,
  summarizeReEntry,
} from "@/lib/workspace/re-entry-core";

type ReEntrySnapshot = {
  absence_seconds: number | null;
  last_seen_at: string | null;
  since: ReEntryCounts;
  items: ReEntryItem[];
};

// Where each category actually lives. Superseded truth and open questions are
// nodes on the graph; candidates are the inbox's whole job.
const CATEGORY_VIEW: Record<ReEntryCategory, WorkspaceView> = {
  superseded_truth: "truth-graph",
  mcp_writes: "inbox",
  new_candidates: "inbox",
  unresolved_open_questions: "truth-graph",
};

function formatAway(t: ReturnType<typeof useLocale>["t"], seconds: number) {
  const hours = Math.floor(seconds / 3600);

  if (hours >= 24) {
    return t("reEntry.away.days", { days: Math.floor(hours / 24) });
  }

  return t("reEntry.away.hours", { hours: Math.max(1, hours) });
}

/**
 * The "since last visit" bar.
 *
 * It sits between the header and the stage — on the surface the user actually
 * lands on — rather than inside the IR drawer, where its predecessor lived. A
 * change report that only renders after the user opens a panel is a change
 * report for someone who already suspects something changed, which is the one
 * person who does not need it.
 *
 * It leads with the single most consequential change by name, not with a total.
 * "6 updates" cannot tell the user whether to stop what they were doing; "a
 * confirmed truth was overturned: X" can.
 */
export function ChangeBar({
  onGoTo,
}: {
  onGoTo: (view: WorkspaceView) => void;
}) {
  const { t } = useLocale();
  const { activeProjectId } = useWorkspace();
  const [snapshot, setSnapshot] = useState<ReEntrySnapshot | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!activeProjectId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    setDismissed(false);
    setExpanded(false);

    fetcher(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${activeProjectId}/re-entry`
    )
      .then((payload: ReEntrySnapshot) => {
        if (!cancelled) {
          setSnapshot(payload);
        }
      })
      .catch((error) => {
        console.error("Failed to load re-entry snapshot", error);
        if (!cancelled) {
          setSnapshot(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  // Marking "seen" on exit rather than on mount is deliberate: the absence
  // window has to be measured from the last time the user could have looked,
  // not from the moment the page happened to load.
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

  async function markSeen() {
    setDismissed(true);

    if (!activeProjectId) {
      return;
    }

    try {
      await postJSON(`/api/projects/${activeProjectId}/re-entry/mark-seen`);
    } catch (error) {
      console.error("Failed to mark re-entry reviewed", error);
    }
  }

  const visible = shouldShowReEntry({
    absenceSeconds: snapshot?.absence_seconds ?? null,
    counts: snapshot?.since ?? null,
    dismissed,
  });

  if (!(visible && snapshot)) {
    return null;
  }

  const headline = selectReEntryHeadline({
    counts: snapshot.since,
    items: snapshot.items ?? [],
  });

  if (!headline.category) {
    return null;
  }

  const headlineText = headline.item
    ? t(`reEntry.headline.${headline.category}`, {
        title: headline.item.title,
      })
    : t(`reEntry.headline.plain.${headline.category}`, {
        count: snapshot.since[headline.category],
      });

  const awayLabel = formatAway(t, snapshot.absence_seconds ?? 0);
  const needsReview = countReEntryNeedsReview(snapshot.since);
  // A long absence opens the card by default: after a day away the user has no
  // working memory of the project to attach a one-liner to.
  const showCard =
    expanded ||
    (snapshot.absence_seconds ?? 0) >= RE_ENTRY_FULL_THRESHOLD_SECONDS;
  const rows = summarizeReEntry(snapshot.since);

  function goToTopCategory() {
    if (headline.category) {
      onGoTo(CATEGORY_VIEW[headline.category]);
    }
    markSeen();
  }

  return (
    <section
      aria-label={t("reEntry.title")}
      className="border-[var(--ir-border-default)] border-b bg-[var(--ir-bg-elevated)]"
      data-testid="change-bar"
    >
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          aria-expanded={showCard}
          aria-label={showCard ? t("reEntry.collapse") : t("reEntry.expand")}
          className="-mx-1 flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[var(--ir-bg-hover)]"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {showCard ? (
            <ChevronDownIcon className="size-3.5 shrink-0 text-[var(--ir-text-tertiary)]" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 text-[var(--ir-text-tertiary)]" />
          )}
          <span className="shrink-0 font-medium text-[var(--ir-text-tertiary)] text-xs">
            {awayLabel}
          </span>
          <span className="truncate text-[var(--ir-text-primary)] text-sm">
            {headlineText}
          </span>
          {headline.othersCount > 0 ? (
            <span className="shrink-0 text-[var(--ir-text-tertiary)] text-xs">
              {t("reEntry.others", { count: headline.othersCount })}
            </span>
          ) : null}
        </button>

        <Button
          className="shrink-0 rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
          onClick={goToTopCategory}
          size="sm"
          variant="outline"
        >
          {t("reEntry.review")}
        </Button>
        <Button
          aria-label={t("reEntry.dismiss")}
          className="shrink-0 rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
          onClick={markSeen}
          size="icon-sm"
          variant="outline"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {showCard ? (
        <div className="px-4 pb-3">
          <div className="divide-y divide-[var(--ir-border-default)] border-[var(--ir-border-default)] border-y">
            {rows.map((row) => (
              <button
                className="flex w-full items-center justify-between gap-3 px-1 py-2 text-left hover:bg-[var(--ir-bg-hover)]"
                key={row.category}
                onClick={() => {
                  onGoTo(CATEGORY_VIEW[row.category]);
                  markSeen();
                }}
                type="button"
              >
                <span className="text-[var(--ir-text-primary)] text-sm">
                  {t(`reEntry.row.${row.category}`)} ({row.count})
                </span>
                {row.attribution > 0 ? (
                  <span className="text-[var(--ir-text-tertiary)] text-xs">
                    {t("reEntry.row.attribution", { count: row.attribution })}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[var(--ir-text-tertiary)] text-xs">
              {t("reEntry.needsReview", { count: needsReview })}
            </span>
            <Button
              className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
              onClick={markSeen}
              size="sm"
              variant="outline"
            >
              {t("reEntry.markReviewed")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
