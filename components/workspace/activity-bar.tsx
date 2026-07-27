"use client";

import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { useLocale } from "@/components/i18n/locale-provider";
import { postJSON } from "@/components/ir/use-ir-actions";
import { Button } from "@/components/ui/button";
import { ISLAND_SURFACE } from "@/components/workspace/island";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  formatCost,
  formatElapsed,
  type RunProgress,
  type RunStatus,
  type RunType,
  type RunView,
  summarizeActivity,
} from "@/lib/research/run-progress-core";
import { cn, fetcher } from "@/lib/utils";

type ActivityRow = {
  id: string;
  runType: RunType;
  status: RunStatus;
  label: string | null;
  progress: RunProgress | null;
  costEstimate: number | null;
  createdAt: string;
  finishedAt: string | null;
};

type ActivityPayload = { runs: ActivityRow[]; now: string };

// Poll hard while something is running, and barely at all otherwise. The bar's
// whole value is being current about work in flight; when nothing is in flight
// there is nothing to be current about, and a new run started elsewhere (the
// nightly patrol) can wait 30s to appear.
const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 30_000;

// Sweep does not read the cancel flag — it is one model call inside 950 lines
// of extraction, and threading a cancel through it buys back about a fifth of a
// cent. So sweep gets no stop button. A button that flips the row to
// `cancelling` and then watches the sweep settle it `done` anyway would be
// worse than no button: it would teach the user that stop does not work.
const CANCELLABLE: readonly RunType[] = ["research", "patrol"];

function useTick(activeMs: number | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (activeMs === null) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), activeMs);
    return () => clearInterval(timer);
  }, [activeMs]);

  return now;
}

/**
 * The phase rail.
 *
 * Segments, not a percentage. We do not know how long a run takes, but we do
 * know how many phases it has and which one it is in, and that is the only
 * determinacy we are entitled to claim. The current segment fills
 * proportionally when — and only when — it has a real denominator (the
 * collect budget); otherwise it pulses, which says "working, duration unknown"
 * instead of inventing a fraction.
 */
function PhaseRail({ view }: { view: RunView }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
      {view.rail.map((phase, index) => {
        const complete = index < view.completedPhases;
        const current = view.active && index === view.phaseIndex;

        return (
          <span
            className="h-1 w-5 overflow-hidden rounded-full bg-[var(--ir-border-default)]"
            key={phase}
          >
            {complete ? (
              <span className="block h-full w-full bg-[var(--ir-text-tertiary)]" />
            ) : null}
            {current && view.phaseFill !== null ? (
              <span
                className="block h-full bg-[var(--ir-text-primary)]"
                style={{ width: `${Math.round(view.phaseFill * 100)}%` }}
              />
            ) : null}
            {current && view.phaseFill === null ? (
              <span className="block h-full w-full animate-pulse bg-[var(--ir-text-primary)]" />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

function RunLine({
  view,
  onCancel,
  cancelling,
}: {
  view: RunView;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const { t } = useLocale();
  const phaseKey =
    view.phaseIndex >= 0 ? view.rail[view.phaseIndex] : "pending";
  const stopping = cancelling || view.status === "cancelling";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <PhaseRail view={view} />

      <span className="shrink-0 font-medium text-[var(--ir-text-primary)] text-sm">
        {t(`activity.runType.${view.runType}`)}
      </span>

      {view.label ? (
        <span className="truncate text-[var(--ir-text-secondary)] text-sm">
          {view.label}
        </span>
      ) : null}

      <span className="shrink-0 text-[var(--ir-text-tertiary)] text-xs">
        {t(`activity.phase.${phaseKey}`)}
        {view.phaseCounter
          ? ` ${t("activity.counter", {
              used: view.phaseCounter.used,
              max: view.phaseCounter.max,
            })}`
          : ""}
      </span>

      <span className="shrink-0 text-[var(--ir-text-tertiary)] text-xs tabular-nums">
        {formatElapsed(view.elapsedSeconds)}
      </span>

      {/* Cost is never rounded away. A run that has not reported a cost says so
          rather than showing $0.00 — "free" and "unmeasured" are different
          claims, and only one of them is true. */}
      <span className="shrink-0 text-[var(--ir-text-tertiary)] text-xs tabular-nums">
        {view.cost === null
          ? t("activity.costPending")
          : t("activity.costEstimate", { cost: formatCost(view.cost) })}
      </span>

      {view.stale ? (
        <span
          className="flex shrink-0 items-center gap-1 text-[var(--ir-text-tertiary)] text-xs"
          title={t("activity.staleHint")}
        >
          <AlertTriangleIcon className="size-3" />
          {t("activity.stale")}
        </span>
      ) : null}

      <span className="flex-1" />

      {CANCELLABLE.includes(view.runType) ? (
        <Button
          className="shrink-0 rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
          disabled={stopping}
          onClick={() => onCancel(view.id)}
          size="sm"
          variant="outline"
        >
          {stopping ? t("activity.cancelling") : t("activity.cancel")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The one bar under the header: what is running right now.
 *
 * It used to carry a second job — "what changed while I was away" — on the
 * theory that in-flight work and just-settled work are the same object caught
 * at two moments. Amendment №4 §2 moved that job onto the canvas as the
 * re-entry overlay, because a report the user meets on arrival has to sit where
 * the evidence is, and because the resting state it collapses into (№1 §6's
 * global pending strip) already lives inside the lanes. What is left here is
 * the half that was always about the present.
 *
 * There is deliberately no dismiss control. A run in flight is spending the
 * user's money whether or not the bar is on screen, and letting them hide it
 * would make the product quieter about cost exactly when it should be loudest.
 */
export function ActivityBar() {
  const { t } = useLocale();
  const { activeProjectId } = useWorkspace();
  // `null` means "follow the default", which for concurrent runs is open.
  //
  // This used to be a plain `useState(false)`, so the one situation the bar
  // exists for — several runs burning money at once — was also the one it
  // refused to show: the phase rails, the per-run cost and every Stop button
  // were behind a disclosure triangle. A default is a claim about what the
  // user wants to see, and "less, exactly when there is more happening" is the
  // wrong claim. Collapsing stays available; it is now a choice rather than
  // the starting position.
  const [collapseOverride, setCollapseOverride] = useState<boolean | null>(
    null
  );
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({});

  const { data, mutate } = useSWR<ActivityPayload>(
    activeProjectId
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${activeProjectId}/activity`
      : null,
    fetcher,
    {
      refreshInterval: (payload) =>
        payload?.runs.some(
          (run) => run.status === "running" || run.status === "cancelling"
        )
          ? ACTIVE_POLL_MS
          : IDLE_POLL_MS,
      revalidateOnFocus: true,
    }
  );

  const rows = data?.runs ?? [];
  const hasActive = rows.some(
    (run) => run.status === "running" || run.status === "cancelling"
  );

  // Elapsed time is recomputed locally between polls so the seconds move, but
  // only while there is something to count. A ticking clock over a settled
  // project is a component telling the user it is busy when it is not.
  const now = useTick(hasActive ? 1000 : null);

  // Forget the override once the burst it applied to is over. Collapsing means
  // "not these runs", not "never show me runs again" — carrying the choice into
  // an unrelated burst hours later would silently reinstate the bad default.
  useEffect(() => {
    if (!hasActive) {
      setCollapseOverride(null);
    }
  }, [hasActive]);

  const summary = summarizeActivity({
    runs: rows.map((run) => ({
      id: run.id,
      runType: run.runType,
      status: run.status,
      // A sweep has no origin node to borrow a title from, so it falls back to
      // naming the operation. Better an honest generic than a blank line.
      label: run.label ?? "",
      progress: run.progress,
      costEstimate: run.costEstimate,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
    })),
    nowMs: now,
  });

  async function cancelRun(runId: string) {
    if (!activeProjectId) {
      return;
    }

    setCancelling((current) => ({ ...current, [runId]: true }));

    try {
      await postJSON(`/api/research/runs/${runId}/cancel`, {
        project_id: activeProjectId,
      });
    } catch (error) {
      console.error("Failed to cancel run", error);
      setCancelling((current) => ({ ...current, [runId]: false }));
    }

    await mutate();
  }

  if (!(summary.headline && activeProjectId)) {
    // The change bar used to live here. Amendment №4 §2.1 moved the re-entry
    // report onto the canvas as an overlay, and №1 §6's global pending strip —
    // already rendered inside SemanticLanes — is the resting state it collapses
    // back into. Two surfaces reporting the same pending set, on two different
    // absence thresholds (30min/24h here vs 24h/14d there), could only ever
    // disagree; the user would then have to work out which one was lying.
    return null;
  }

  const multiple = summary.active.length > 1;
  const showAll = multiple && !collapseOverride;

  return (
    <section
      aria-label={t("activity.title")}
      className={cn(ISLAND_SURFACE, "flex max-w-3xl flex-col overflow-hidden")}
      data-testid="activity-bar"
    >
      <div className="flex items-center gap-3 px-3 py-2">
        {multiple ? (
          <button
            aria-expanded={showAll}
            aria-label={showAll ? t("activity.collapse") : t("activity.expand")}
            className="-mx-1 flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[var(--ir-bg-hover)]"
            onClick={() => setCollapseOverride(showAll)}
            type="button"
          >
            {showAll ? (
              <ChevronDownIcon className="size-3.5 shrink-0 text-[var(--ir-text-tertiary)]" />
            ) : (
              <ChevronRightIcon className="size-3.5 shrink-0 text-[var(--ir-text-tertiary)]" />
            )}
            <span className="shrink-0 font-medium text-[var(--ir-text-primary)] text-sm">
              {t("activity.multi", { count: summary.active.length })}
            </span>
            <span className="shrink-0 text-[var(--ir-text-tertiary)] text-xs tabular-nums">
              {t("activity.longest", {
                elapsed: formatElapsed(summary.headline.elapsedSeconds),
              })}
            </span>
            {summary.totalCost === null ? null : (
              <span className="shrink-0 text-[var(--ir-text-tertiary)] text-xs tabular-nums">
                {t("activity.totalCost", {
                  cost: formatCost(summary.totalCost),
                })}
              </span>
            )}
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <RunLine
              cancelling={Boolean(cancelling[summary.headline.id])}
              onCancel={cancelRun}
              view={summary.headline}
            />
          </div>
        )}
      </div>

      {/* Bounded, because "show everything by default" has to stay true even
          when everything is eight runs deep: past ~40vh the island would be
          covering the stage it is reporting on. */}
      {showAll ? (
        <div className="max-h-[40vh] divide-y divide-[var(--ir-border-default)] overflow-y-auto border-[var(--ir-border-default)] border-t px-3">
          {summary.active.map((view) => (
            <div className="py-2" key={view.id}>
              <RunLine
                cancelling={Boolean(cancelling[view.id])}
                onCancel={cancelRun}
                view={view}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
