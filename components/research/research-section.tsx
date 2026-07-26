"use client";

import { GlobeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "@/components/chat/toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { irNodeKey } from "@/components/ir/ir-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatCost } from "@/lib/research/run-progress-core";
import { fetcher } from "@/lib/utils";

// Types mirror lib/research/queries.ts (server-only module — `import type`
// is erased at compile time but the Next bundler may still complain about
// importing from a server-only file in a client component; local copies are
// the safe fallback).
type ResearchRunStatus =
  | "running"
  | "cancelling"
  | "cancelled"
  | "done"
  | "partial"
  | "failed";

// Both states in which the run is still holding resources. `cancelling` counts:
// the user has asked it to stop but it has not stopped yet, and offering them a
// second "start research" button in that window would start a second run.
const ACTIVE_STATUSES: readonly ResearchRunStatus[] = ["running", "cancelling"];

type RunEstimate = {
  budget: { max_searches: number; max_fetches: number };
  bounds: {
    maxSearches: { min: number; max: number };
    maxFetches: { min: number; max: number };
  };
  typical_cost: number | null;
  sample_size: number;
};

type ResearchRun = {
  id: string;
  projectId: string;
  topicId: string | null;
  originNodeId: string;
  plan: unknown;
  brief: string | null;
  status: ResearchRunStatus;
  error: string | null;
  budget: unknown;
  costEstimate: number | null;
  modelsUsed: unknown;
  createdAt: string;
  finishedAt: string | null;
};

type EvidenceItem = {
  id: string;
  projectId: string;
  runId: string;
  nodeId: string;
  url: string;
  title: string | null;
  quote: string;
  claim: string;
  stance: "supports" | "contradicts" | "neutral";
  retrievedAt: string;
  createdAt: string;
};

const POLL_MS = 5000;

// Stance colors come from the IR design tokens (globals.css) so they track the
// light/dark panel theme, like the rest of this component.
const STANCE_STYLE: Record<EvidenceItem["stance"], string> = {
  supports: "bg-[var(--ir-success-bg)] text-[var(--ir-success-fg)]",
  contradicts: "bg-[var(--ir-warning-bg)] text-[var(--ir-warning-fg)]",
  neutral: "bg-[var(--ir-bg-hover)] text-[var(--ir-text-tertiary)]",
};

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ResearchSection({
  nodeId,
  onLanded,
}: {
  nodeId: string;
  onLanded: () => void;
}) {
  const { t } = useLocale();
  const { mutate } = useSWRConfig();
  const [isStarting, setIsStarting] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  // Null means "use whatever the server's default is". Kept null rather than
  // pre-filled with the default so an untouched panel sends no override at all,
  // and a run started today is not silently pinned to yesterday's default.
  const [override, setOverride] = useState<{
    maxSearches: number | null;
    maxFetches: number | null;
  }>({ maxSearches: null, maxFetches: null });
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const runsKey = `${basePath}/api/research/runs?nodeId=${encodeURIComponent(nodeId)}`;
  const evidenceKey = `${basePath}/api/research/evidence?nodeId=${encodeURIComponent(nodeId)}`;
  const estimateKey = `${basePath}/api/research/run?node_id=${encodeURIComponent(nodeId)}`;
  const { data: runsData, mutate: mutateRuns } = useSWR<{
    runs: ResearchRun[];
  }>(runsKey, fetcher, {
    revalidateOnFocus: false,
    // Function form: supported in installed SWR (refreshInterval?: number | ((latestData) => number))
    refreshInterval: (latest) =>
      latest?.runs.some((run) => ACTIVE_STATUSES.includes(run.status))
        ? POLL_MS
        : 0,
  });
  const { data: evidenceData, mutate: mutateEvidence } = useSWR<{
    evidence: EvidenceItem[];
  }>(evidenceKey, fetcher, { revalidateOnFocus: false });
  // Fetched once when the section opens. The anchor it provides is the median
  // of this project's own finished runs — a measurement, not a forecast — so it
  // does not need to be re-read while the user reads it.
  const { data: estimate } = useSWR<RunEstimate>(estimateKey, fetcher, {
    revalidateOnFocus: false,
  });

  const latestRun = runsData?.runs[0] ?? null;
  const isRunning =
    isStarting ||
    (latestRun !== null && ACTIVE_STATUSES.includes(latestRun.status));
  // The evidence endpoint returns every row for the node across all runs; scope
  // the display to the latest run so it stays consistent with the run summary
  // (which only shows the latest run) instead of mixing evidence from old runs.
  const evidence = (evidenceData?.evidence ?? []).filter(
    (item) => latestRun !== null && item.runId === latestRun.id
  );

  // Everything a finished run produced, pulled in the moment the polled status
  // leaves an active state. This is the only place it can be pulled in from
  // now that starting a run returns before the run has done anything: the POST
  // that starts it knows nothing about what it will find, so the "it landed"
  // moment is a status transition, not a response. A ref guards the initial
  // mount so this fires on an actual change rather than on arrival.
  const prevRunStatusRef = useRef<ResearchRunStatus | null | undefined>(
    undefined
  );
  useEffect(() => {
    const prev = prevRunStatusRef.current;
    const next = latestRun?.status;
    prevRunStatusRef.current = next;
    // Skip the first render (prev === undefined) and only fire when the run
    // leaves an active state for a terminal one. A cancelled run counts: it can
    // still have landed evidence before it stopped.
    if (
      prev !== undefined &&
      prev !== null &&
      ACTIVE_STATUSES.includes(prev) &&
      next !== undefined &&
      !ACTIVE_STATUSES.includes(next)
    ) {
      mutateEvidence().catch(console.error);
      // The node's own detail carries the edges the run's candidates hang off.
      mutate(irNodeKey(nodeId)).catch(console.error);
      onLanded();
    }
  }, [latestRun?.status, mutateEvidence, mutate, nodeId, onLanded]);

  async function handleResearch() {
    setIsStarting(true);

    try {
      const response = await fetch(`${basePath}/api/research/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_id: nodeId,
          ...(override.maxSearches === null
            ? {}
            : { max_searches: override.maxSearches }),
          ...(override.maxFetches === null
            ? {}
            : { max_fetches: override.maxFetches }),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        const description =
          payload?.code === "service_unavailable:research"
            ? t("detail.researchUnavailableToast")
            : t("detail.researchFailedToast");
        toast({ type: "error", description });
        return;
      }

      // The route answers 202 as soon as the run row exists; nothing has been
      // researched yet. So this says "started", and the landing — evidence,
      // candidates, the node's own edges — is picked up by the effect above
      // when the polled run leaves an active status. Claiming results here
      // would be claiming them before they exist.
      toast({
        type: "success",
        description: t("detail.researchStartedToast"),
      });
    } catch (error) {
      console.error(error);
      toast({ type: "error", description: t("detail.researchFailedToast") });
    } finally {
      // Revalidated before the starting flag is cleared, not after, so the
      // button hands over from "starting" to "running" in one render instead
      // of flickering back to idle until the next poll. Only the run list is
      // pulled: nothing has been researched yet, so there is no new evidence
      // and no new edge to fetch.
      await mutateRuns();
      setIsStarting(false);
    }
  }

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ir-text-tertiary)]">
        {t("detail.research")}
      </p>

      <div className="flex items-center gap-2">
        <Button
          disabled={isRunning}
          onClick={handleResearch}
          size="sm"
          variant="secondary"
        >
          {isRunning ? (
            <Spinner className="size-4" />
          ) : (
            <GlobeIcon className="size-4" />
          )}
          {isRunning ? t("detail.researchRunning") : t("detail.researchAction")}
        </Button>

        {estimate ? (
          <Button
            className="text-xs"
            onClick={() => setBudgetOpen((current) => !current)}
            size="sm"
            variant="ghost"
          >
            {t("detail.researchBudgetToggle")} ·{" "}
            {override.maxSearches ?? estimate.budget.max_searches}/
            {override.maxFetches ?? estimate.budget.max_fetches}
          </Button>
        ) : null}
      </div>

      {/* What this is likely to cost, said before the money is spent rather
          than after. It is the median of this project's own finished runs — a
          measurement of history, not a priced forecast — so when there is no
          history it says so instead of showing a placeholder number. */}
      {estimate ? (
        <p className="text-xs text-[var(--ir-text-tertiary)]">
          {estimate.typical_cost === null
            ? t("detail.researchEstimateUnknown")
            : t("detail.researchEstimateKnown", {
                cost: formatCost(estimate.typical_cost),
                count: estimate.sample_size,
              })}
        </p>
      ) : null}

      {budgetOpen && estimate ? (
        <BudgetEditor
          estimate={estimate}
          onChange={setOverride}
          override={override}
        />
      ) : null}

      <p className="text-xs text-[var(--ir-text-tertiary)]">
        {t("detail.researchCaption")}
      </p>

      {latestRun ? (
        <RunSummary run={latestRun} />
      ) : (
        <p className="text-xs text-[var(--ir-text-tertiary)]">
          {t("detail.researchNoRuns")}
        </p>
      )}

      {evidence.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--ir-text-secondary)]">
            {t("detail.researchEvidence", { count: evidence.length })}
          </p>
          <ul className="space-y-2">
            {evidence.map((item) => (
              <li
                className="rounded-lg border border-[var(--ir-border-default)] p-2 text-xs"
                key={item.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <a
                    className="truncate font-medium text-[var(--ir-accent-blue)] hover:underline"
                    href={item.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {item.title || hostOf(item.url)}
                  </a>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${STANCE_STYLE[item.stance]}`}
                  >
                    {t(
                      item.stance === "supports"
                        ? "detail.researchStanceSupports"
                        : item.stance === "contradicts"
                          ? "detail.researchStanceContradicts"
                          : "detail.researchStanceNeutral"
                    )}
                  </span>
                </div>
                <blockquote className="mt-1 border-l-2 border-[var(--ir-border-strong)] pl-2 italic text-[var(--ir-text-secondary)]">
                  {item.quote}
                </blockquote>
                <p className="mt-1 text-[var(--ir-text-secondary)]">
                  {item.claim}
                </p>
                <p className="mt-1 text-[10px] text-[var(--ir-text-tertiary)]">
                  {t("detail.researchRetrieved")}{" "}
                  {new Date(item.retrievedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The pre-run budget.
 *
 * Two numbers, editable, bounded by what one serverless invocation can finish
 * inside — the bounds come from the server rather than being duplicated here,
 * because a field whose values silently cannot work is worse than no field.
 *
 * Deliberately does not rescale the cost estimate above when the user raises
 * the budget. It would be easy to multiply, and the product would be a made-up
 * number: past runs cost what they cost at the budgets they used, and that is
 * the only thing we actually measured.
 */
function BudgetEditor({
  estimate,
  override,
  onChange,
}: {
  estimate: RunEstimate;
  override: { maxSearches: number | null; maxFetches: number | null };
  onChange: (next: {
    maxSearches: number | null;
    maxFetches: number | null;
  }) => void;
}) {
  const { t } = useLocale();

  const fields = [
    {
      key: "maxSearches" as const,
      label: t("detail.researchBudgetSearches"),
      bounds: estimate.bounds.maxSearches,
      fallback: estimate.budget.max_searches,
    },
    {
      key: "maxFetches" as const,
      label: t("detail.researchBudgetFetches"),
      bounds: estimate.bounds.maxFetches,
      fallback: estimate.budget.max_fetches,
    },
  ];

  return (
    <div className="space-y-2 rounded-lg border border-[var(--ir-border-default)] p-2">
      <div className="flex flex-wrap items-center gap-3">
        {fields.map((field) => (
          <label
            className="flex items-center gap-1.5 text-xs text-[var(--ir-text-secondary)]"
            key={field.key}
          >
            {field.label}
            <input
              className="w-14 rounded border border-[var(--ir-border-strong)] bg-transparent px-1.5 py-0.5 text-right text-xs tabular-nums"
              max={field.bounds.max}
              min={field.bounds.min}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                onChange({
                  ...override,
                  [field.key]: Number.isNaN(parsed) ? null : parsed,
                });
              }}
              type="number"
              value={override[field.key] ?? field.fallback}
            />
            <span className="text-[10px] text-[var(--ir-text-tertiary)]">
              ≤{field.bounds.max}
            </span>
          </label>
        ))}

        <Button
          className="text-xs"
          onClick={() => onChange({ maxSearches: null, maxFetches: null })}
          size="sm"
          variant="ghost"
        >
          {t("detail.researchBudgetReset")}
        </Button>
      </div>
      <p className="text-[10px] text-[var(--ir-text-tertiary)]">
        {t("detail.researchBudgetHint")}
      </p>
    </div>
  );
}

const RUN_STATUS_KEY: Record<ResearchRunStatus, string> = {
  done: "detail.researchStatusDone",
  partial: "detail.researchStatusPartial",
  failed: "detail.researchStatusFailed",
  cancelling: "detail.researchStatusCancelling",
  cancelled: "detail.researchStatusCancelled",
  running: "detail.researchStatusRunning",
};

function RunSummary({ run }: { run: ResearchRun }) {
  const { t } = useLocale();
  const statusKey =
    RUN_STATUS_KEY[run.status] ?? "detail.researchStatusRunning";

  return (
    <div className="space-y-1 rounded-lg border border-[var(--ir-border-default)] p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-[var(--ir-text-secondary)]">
          {t(statusKey)}
        </span>
        <span className="text-[10px] text-[var(--ir-text-tertiary)]">
          {new Date(run.createdAt).toLocaleString()}
          {run.costEstimate == null
            ? ""
            : ` · ${t("detail.researchCost")} $${run.costEstimate.toFixed(3)}`}
        </span>
      </div>
      {run.error ? (
        <p className="text-[var(--ir-warning-fg)]">{run.error}</p>
      ) : null}
      {run.brief ? <BriefBody brief={run.brief} /> : null}
    </div>
  );
}

// Brief is rendered as plain text in a collapsible <details>.
// Streamdown was considered but requires cjk/code/math/mermaid plugins —
// too heavy for this surface. Plain whitespace-pre-wrap is sufficient.
function BriefBody({ brief }: { brief: string }) {
  const { t } = useLocale();

  return (
    <details>
      <summary className="cursor-pointer text-[var(--ir-text-secondary)]">
        {t("detail.researchBrief")}
      </summary>
      <div className="mt-1 whitespace-pre-wrap text-[var(--ir-text-secondary)]">
        {brief}
      </div>
    </details>
  );
}
