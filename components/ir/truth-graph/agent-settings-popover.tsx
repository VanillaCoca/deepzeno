"use client";

// Research-agent settings, right on the truth graph header (the product
// surface where assumptions live): patrol master switch, default cadence,
// research model (DeepSeek by default), and a "patrol now" trigger. All
// writes go through /api/watchtower; the popover never touches truth.

import { BotIcon, RadarIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/chat/toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type {
  AgentSettings,
  PatrolCadence,
} from "@/lib/research/agent-settings";
import type { IRWatch } from "@/lib/research/watch-types";
import { fetcher } from "@/lib/utils";

export type WatchtowerData = {
  watches: IRWatch[];
  settings: AgentSettings;
};

const CADENCE_KEYS: Record<PatrolCadence, string> = {
  daily: "wt.cadenceDaily",
  every_3_days: "wt.cadenceEvery3Days",
  weekly: "wt.cadenceWeekly",
};

// Patrol-now runs at most this many active watches from the popover.
const PATROL_NOW_MAX = 3;

type ModelsPayload = {
  models: Array<{ id: string; name: string }>;
};

export function AgentSettingsPopover({
  data,
  notMigrated,
  onChanged,
  projectId,
}: {
  data: WatchtowerData | null;
  // True when the watchtower API reported a not-yet-migrated schema.
  notMigrated: boolean;
  onChanged: () => void;
  projectId: string;
}) {
  const { t } = useLocale();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [isPatrolling, setIsPatrolling] = useState(false);
  const { data: modelsData } = useSWR<ModelsPayload>(
    `${basePath}/api/models`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const settings = data?.settings ?? null;
  const watches = data?.watches ?? [];
  const activeWatches = watches.filter((watch) => watch.status === "active");
  const lastPatrolAt = watches
    .map((watch) => watch.lastPatrolAt)
    .filter((time): time is string => Boolean(time))
    .sort()
    .at(-1);

  const defaultModelName =
    modelsData?.models.find((model) => model.id === "deepseek:default")?.name ??
    "Auto";

  async function patchSettings(patch: Record<string, unknown>) {
    const response = await fetch(`${basePath}/api/watchtower`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: projectId, ...patch }),
    });
    if (!response.ok) {
      toast({
        type: "error",
        description: t("wt.patrolFailed", { detail: `${response.status}` }),
      });
      return;
    }
    onChanged();
  }

  async function patrolNow() {
    if (activeWatches.length === 0 || isPatrolling) {
      return;
    }
    setIsPatrolling(true);
    try {
      let alerted = 0;
      for (const watch of activeWatches.slice(0, PATROL_NOW_MAX)) {
        const response = await fetch(`${basePath}/api/watchtower/patrol`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ watch_id: watch.id }),
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            result?: { status?: string };
          };
          if (payload.result?.status === "signal_alerted") {
            alerted += 1;
          }
        }
      }
      toast({
        type: "success",
        description: alerted > 0 ? t("wt.patrolAlerted") : t("wt.patrolQuiet"),
      });
      onChanged();
    } finally {
      setIsPatrolling(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={t("wt.settingsTitle")}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--z-topic-border)] bg-[var(--z-card-bg)] px-2.5 py-1 text-[var(--z-text-3)] text-xs hover:text-[var(--z-text)]"
          data-testid="agent-settings-trigger"
          type="button"
        >
          <BotIcon className="size-3.5" />
          {t("wt.settingsTitle")}
          {activeWatches.length > 0 ? (
            <span className="flex items-center gap-0.5 text-[11px]">
              <RadarIcon className="size-3" />
              {activeWatches.length}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 text-sm">
        <div>
          <p className="font-medium text-[var(--z-text)]">
            {t("wt.settingsTitle")}
          </p>
          <p className="mt-1 text-[var(--z-text-3)] text-xs leading-relaxed">
            {t("wt.settingsHint")}
          </p>
        </div>

        {notMigrated ? (
          <p className="rounded-md bg-[var(--z-attention-soft)] p-2 text-[var(--z-attention-text)] text-xs">
            {t("wt.notMigrated")}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--z-text-2)]">
            {t("wt.patrolEnabled")}
          </span>
          <Button
            data-testid="agent-settings-patrol-toggle"
            disabled={!settings}
            onClick={() =>
              patchSettings({ patrol_enabled: !settings?.patrolEnabled })
            }
            size="sm"
            variant={settings?.patrolEnabled ? "default" : "outline"}
          >
            {settings?.patrolEnabled ? t("wt.on") : t("wt.off")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--z-text-2)]">
            {t("wt.defaultCadence")}
          </span>
          <Select
            disabled={!settings}
            onValueChange={(value) => patchSettings({ default_cadence: value })}
            value={settings?.defaultCadence ?? "daily"}
          >
            <SelectTrigger className="h-8 w-32" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CADENCE_KEYS) as PatrolCadence[]).map((cadence) => (
                <SelectItem key={cadence} value={cadence}>
                  {t(CADENCE_KEYS[cadence])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--z-text-2)]">
            {t("wt.researchModel")}
          </span>
          <Select
            disabled={!settings}
            onValueChange={(value) =>
              patchSettings({
                research_model_id: value === "__default__" ? null : value,
              })
            }
            value={settings?.researchModelId ?? "__default__"}
          >
            <SelectTrigger className="h-8 w-40" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">
                {t("wt.researchModelDefault", { name: defaultModelName })}
              </SelectItem>
              {(modelsData?.models ?? []).map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2 border-[var(--z-topic-border)] border-t pt-3">
          <span className="text-[var(--z-text-3)] text-xs">
            {lastPatrolAt
              ? t("wt.lastPatrol", {
                  time: new Date(lastPatrolAt).toLocaleString(),
                })
              : t("wt.neverPatrolled")}
          </span>
          <Button
            data-testid="agent-settings-patrol-now"
            disabled={isPatrolling || activeWatches.length === 0}
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
      </PopoverContent>
    </Popover>
  );
}
