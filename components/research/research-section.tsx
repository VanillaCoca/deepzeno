"use client";

import { GlobeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "@/components/chat/toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { irNodeKey } from "@/components/ir/ir-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetcher } from "@/lib/utils";

// Types mirror lib/research/queries.ts (server-only module — `import type`
// is erased at compile time but the Next bundler may still complain about
// importing from a server-only file in a client component; local copies are
// the safe fallback).
type ResearchRunStatus = "running" | "done" | "partial" | "failed";

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

const STANCE_STYLE: Record<EvidenceItem["stance"], string> = {
  supports: "bg-emerald-500/10 text-emerald-600",
  contradicts: "bg-amber-500/10 text-amber-600",
  neutral: "bg-muted text-muted-foreground",
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
  const runsKey = `/api/research/runs?nodeId=${encodeURIComponent(nodeId)}`;
  const evidenceKey = `/api/research/evidence?nodeId=${encodeURIComponent(nodeId)}`;
  const { data: runsData, mutate: mutateRuns } = useSWR<{
    runs: ResearchRun[];
  }>(runsKey, fetcher, {
    revalidateOnFocus: false,
    // Function form: supported in installed SWR (refreshInterval?: number | ((latestData) => number))
    refreshInterval: (latest) =>
      latest?.runs.some((run) => run.status === "running") ? POLL_MS : 0,
  });
  const { data: evidenceData, mutate: mutateEvidence } = useSWR<{
    evidence: EvidenceItem[];
  }>(evidenceKey, fetcher, { revalidateOnFocus: false });

  const latestRun = runsData?.runs[0] ?? null;
  const isRunning = isStarting || latestRun?.status === "running";
  const evidence = evidenceData?.evidence ?? [];

  // Fix 2: revalidate evidence when a background-polled run transitions to a
  // terminal state (done / partial / failed).  A ref guards against the initial
  // mount so we only trigger on an actual status change.
  const prevRunStatusRef = useRef<ResearchRunStatus | null | undefined>(
    undefined
  );
  useEffect(() => {
    const prev = prevRunStatusRef.current;
    const next = latestRun?.status;
    prevRunStatusRef.current = next;
    // Skip the first render (prev === undefined) and only fire when the run
    // leaves "running" for a terminal state.
    if (prev === "running" && next !== undefined && next !== "running") {
      mutateEvidence().catch(console.error);
    }
  }, [latestRun?.status, mutateEvidence]);

  async function handleResearch() {
    setIsStarting(true);

    try {
      const response = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: nodeId }),
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

      toast({
        type: "success",
        description: t("detail.researchDoneToast", {
          evidence: payload.evidence_count,
          candidates: payload.candidates_created,
        }),
      });
      // Fix 1: also revalidate the open node's detail SWR key so the Relations
      // section reflects any newly-landed candidate edges immediately.
      await mutate(irNodeKey(nodeId));
      onLanded();
    } catch (error) {
      console.error(error);
      toast({ type: "error", description: t("detail.researchFailedToast") });
    } finally {
      setIsStarting(false);
      await Promise.all([mutateRuns(), mutateEvidence()]);
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
      </div>
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

function RunSummary({ run }: { run: ResearchRun }) {
  const { t } = useLocale();
  const statusKey =
    run.status === "done"
      ? "detail.researchStatusDone"
      : run.status === "partial"
        ? "detail.researchStatusPartial"
        : run.status === "failed"
          ? "detail.researchStatusFailed"
          : "detail.researchStatusRunning";

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
