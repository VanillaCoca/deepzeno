"use client";

// Detail-pane Monitoring section (Watchtower): per-node watch toggle,
// cadence, and "patrol now". Mirrors the visual language of ResearchSection
// (ir design tokens) since both live in the same pane.

import { RadarIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/chat/toast";
import { useLocale } from "@/components/i18n/locale-provider";
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
  }>;
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
        const message =
          response.status === 503
            ? t("wt.notMigrated")
            : t("wt.patrolFailed", { detail: `${response.status}` });
        toast({ type: "error", description: message });
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
        <Button
          data-testid="monitoring-watch-this"
          disabled={isBusy || data?.not_migrated === true}
          onClick={createWatch}
          size="sm"
          variant="outline"
        >
          <RadarIcon className="size-3.5" />
          {t("wt.watchThis")}
        </Button>
      )}
      {data?.not_migrated ? (
        <p className="text-[12px] text-[var(--ir-text-tertiary)]">
          {t("wt.notMigrated")}
        </p>
      ) : null}
    </section>
  );
}
