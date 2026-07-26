"use client";

// Detail-pane Monitoring section (Watchtower): per-node watch toggle,
// cadence, and "patrol now". Mirrors the visual language of ResearchSection
// (ir design tokens) since both live in the same pane.

import { RadarIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/chat/toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { ExplorationDirections } from "@/components/research/exploration-directions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { IRNode } from "@/lib/ir/types";
import type { PatrolCadence } from "@/lib/research/agent-settings";
import { isBackedOff, patrolIntervalDays } from "@/lib/research/patrol-core";
import {
  isCadenceHonored,
  realizedIntervalDays,
} from "@/lib/research/patrol-queue-core";
import type { ExplorationDirection } from "@/lib/research/watch-types";
import { fetcher } from "@/lib/utils";

// Local mirror of lib/research/watch-queries.ts types (server-only module).
type WatchPayload = {
  watches: Array<{
    id: string;
    nodeId: string;
    status: "active" | "paused";
    cadence: PatrolCadence;
    reason: string;
    lastPatrolAt: string | null;
    nextDirections: ExplorationDirection[] | null;
    // Consecutive patrols that found nothing. Optional so a client running
    // against a pre-migration server reads it as "no backoff" rather than NaN.
    quietPatrols?: number;
  }>;
  // Null while the queue keeps up; a number of days once it cannot, meaning the
  // cadence below is a request and this is the delivery.
  queue?: { realized_cycle_days: number | null };
  // How many standing watches this user has, against the cap. Null before the
  // billing tables exist. Rendered whether or not the cap is reached: Zeno
  // also stops proposing watches on its own at this number, and that happens
  // inside a background pipeline with no way to report it. The counter is the
  // only place the user can learn it before it costs them a finding.
  quota?: { active: number; limit: number; admitted: boolean } | null;
  not_migrated?: boolean;
};

const CADENCE_KEYS: Record<PatrolCadence, string> = {
  daily: "wt.cadenceDaily",
  every_3_days: "wt.cadenceEvery3Days",
  weekly: "wt.cadenceWeekly",
};

export function MonitoringSection({
  node,
  onChanged,
}: {
  node: IRNode;
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const watchKey = `${basePath}/api/watchtower?project_id=${encodeURIComponent(node.projectId)}`;
  const { data, mutate } = useSWR<WatchPayload>(watchKey, fetcher, {
    revalidateOnFocus: false,
  });
  const [isBusy, setIsBusy] = useState(false);
  const [isPatrolling, setIsPatrolling] = useState(false);

  const watch = data?.watches.find((item) => item.nodeId === node.id) ?? null;
  const realizedCycleDays = data?.queue?.realized_cycle_days ?? null;
  const quota = data?.quota ?? null;
  const quotaFull = quota ? !quota.admitted : false;
  const eligible =
    node.kind === "hypothesis" ||
    node.kind === "constraint" ||
    node.kind === "open_question";

  if (!(watch || eligible)) {
    return null;
  }

  async function createWatch() {
    setIsBusy(true);
    try {
      const response = await fetch(`${basePath}/api/watchtower`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ node_id: node.id }),
      });
      if (!response.ok) {
        // The 402 body carries the actual numbers in `cause`; a bare status
        // code would tell the user their click failed without telling them the
        // one thing they can act on.
        const body = (await response.json().catch(() => null)) as {
          message?: string;
          cause?: string;
        } | null;
        const message =
          response.status === 503
            ? t("wt.notMigrated")
            : (body?.cause ??
              body?.message ??
              t("wt.patrolFailed", { detail: `${response.status}` }));
        toast({ type: "error", description: message });
        await mutate();
        return;
      }
      await mutate();
      onChanged?.();
    } finally {
      setIsBusy(false);
    }
  }

  async function patchWatch(patch: Record<string, unknown>) {
    if (!watch) {
      return;
    }
    setIsBusy(true);
    try {
      await fetch(`${basePath}/api/watchtower`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ watch_id: watch.id, ...patch }),
      });
      await mutate();
      onChanged?.();
    } finally {
      setIsBusy(false);
    }
  }

  async function patrolNow() {
    if (!watch || isPatrolling) {
      return;
    }
    setIsPatrolling(true);
    try {
      const response = await fetch(`${basePath}/api/watchtower/patrol`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ watch_id: watch.id }),
      });
      if (!response.ok) {
        toast({
          type: "error",
          description: t("wt.patrolFailed", { detail: `${response.status}` }),
        });
        return;
      }
      const payload = (await response.json()) as {
        result?: { status?: string; detail?: string | null };
      };
      const status = payload.result?.status;
      const description =
        status === "signal_alerted"
          ? t("wt.patrolAlerted")
          : status === "signal_suppressed"
            ? t("wt.patrolSuppressed")
            : status === "quiet"
              ? t("wt.patrolQuiet")
              : t("wt.patrolFailed", {
                  detail: payload.result?.detail ?? "unknown",
                });
      toast({
        type: status === "failed" ? "error" : "success",
        description,
      });
      await mutate();
      onChanged?.();
    } finally {
      setIsPatrolling(false);
    }
  }

  return (
    <section className="space-y-2" data-testid="monitoring-section">
      <p className="flex items-center gap-1.5 font-semibold text-[11px] text-[var(--ir-text-tertiary)] uppercase tracking-[0.06em]">
        <RadarIcon className="size-3.5" />
        {t("wt.monitoringTitle")}
      </p>

      {watch ? (
        <div className="space-y-2 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span
              className={
                watch.status === "active"
                  ? "text-[var(--ir-text-primary)]"
                  : "text-[var(--ir-text-tertiary)]"
              }
            >
              {watch.status === "active" ? t("wt.watching") : t("wt.paused")}
            </span>
            <div className="flex items-center gap-1.5">
              <Select
                disabled={isBusy}
                onValueChange={(value) => patchWatch({ cadence: value })}
                value={watch.cadence}
              >
                <SelectTrigger className="h-7 w-28" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CADENCE_KEYS) as PatrolCadence[]).map(
                    (cadence) => (
                      <SelectItem key={cadence} value={cadence}>
                        {t(CADENCE_KEYS[cadence])}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
              <Button
                disabled={isBusy}
                onClick={() =>
                  patchWatch({
                    status: watch.status === "active" ? "paused" : "active",
                  })
                }
                size="sm"
                variant="outline"
              >
                {watch.status === "active" ? t("wt.pause") : t("wt.resume")}
              </Button>
            </div>
          </div>
          {/* Two different reasons the interval above may not be what happens,
              kept apart on purpose. This one is a decision: the watch has
              found nothing enough times that Zeno checks it less often, which
              is reversible and worth explaining. The one below is a shortfall.
              Merging them would produce a single sentence that is a warning
              half the time and an explanation the other half — and the user
              could not tell which, or whether anything they do would help. */}
          {watch.status === "active" &&
          isBackedOff(watch.cadence, watch.quietPatrols ?? 0) ? (
            <p
              className="text-[12px] text-[var(--ir-text-tertiary)] leading-[1.5]"
              data-testid="wt-quiet-backoff"
            >
              {t("wt.quietBackoff", {
                count: `${watch.quietPatrols ?? 0}`,
                days: `${patrolIntervalDays(watch.cadence, watch.quietPatrols ?? 0)}`,
              })}
            </p>
          ) : null}
          {/* The cadence select above is a request, not a guarantee — one daily
              cron serves every watch in the system, so past a certain queue
              depth "daily" silently becomes "monthly". Shown only when the
              queue actually cannot keep up, because a warning that is always
              on is read as decoration. */}
          {watch.status === "active" &&
          !isCadenceHonored(
            watch.cadence,
            realizedCycleDays,
            watch.quietPatrols ?? 0
          ) ? (
            <p
              className="text-[12px] text-[var(--ir-warning-fg)] leading-[1.5]"
              data-testid="wt-cadence-gap"
            >
              {t("wt.cadenceGap", {
                days: `${realizedIntervalDays(watch.cadence, realizedCycleDays, watch.quietPatrols ?? 0)}`,
              })}
            </p>
          ) : null}
          <p className="text-[12px] text-[var(--ir-text-tertiary)] leading-[1.5]">
            {t("wt.reason", { reason: watch.reason })}
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-[var(--ir-text-tertiary)]">
              {watch.lastPatrolAt
                ? t("wt.lastPatrol", {
                    time: new Date(watch.lastPatrolAt).toLocaleString(),
                  })
                : t("wt.neverPatrolled")}
            </span>
            <ExplorationDirections
              directions={watch.nextDirections ?? null}
              nodeId={node.id}
            />
            <Button
              data-testid="monitoring-patrol-now"
              disabled={isPatrolling || watch.status !== "active"}
              onClick={patrolNow}
              size="sm"
              variant="secondary"
            >
              {isPatrolling ? (
                <>
                  <Spinner className="size-3.5" /> {t("wt.patrolRunning")}
                </>
              ) : (
                t("wt.patrolNow")
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Button
            data-testid="monitoring-watch-this"
            disabled={isBusy || data?.not_migrated === true || quotaFull}
            onClick={createWatch}
            size="sm"
            variant="outline"
          >
            <RadarIcon className="size-3.5" />
            {t("wt.watchThis")}
          </Button>
          {quota ? (
            <p
              className={
                quotaFull
                  ? "text-[12px] text-[var(--ir-warning-fg)] leading-[1.5]"
                  : "text-[12px] text-[var(--ir-text-tertiary)] leading-[1.5]"
              }
              data-testid="wt-quota"
            >
              {t(quotaFull ? "wt.quotaFull" : "wt.quotaUsed", {
                active: `${quota.active}`,
                limit: `${quota.limit}`,
              })}
            </p>
          ) : null}
        </div>
      )}
      {data?.not_migrated ? (
        <p className="text-[12px] text-[var(--ir-text-tertiary)]">
          {t("wt.notMigrated")}
        </p>
      ) : null}
    </section>
  );
}
