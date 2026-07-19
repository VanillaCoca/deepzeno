"use client";

// The exploration board for a watched assumption: where the agent plans to
// look next, and every angle it has already tried. This is the surface that
// makes the agent's initiative legible — a patrol that runs nightly is
// invisible until you can see what it is chasing.
//
// Deliberately read-only and flat: two lists, no controls. The board answers
// "what is it thinking?", not "what should it do?" — directing the agent
// stays with the cadence/model controls in MonitoringSection.

import { CompassIcon } from "lucide-react";
import useSWR from "swr";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  type ExplorationDirection,
  isExplorationDirectionArray,
} from "@/lib/research/watch-types";
import { fetcher } from "@/lib/utils";

// Local mirror of the run shape (lib/research/queries.ts is server-only);
// only the fields this board reads.
type RunRow = {
  id: string;
  plan: unknown;
  status: "running" | "done" | "partial" | "failed";
  createdAt: string;
};

const RUN_STATUS_KEYS: Record<RunRow["status"], string> = {
  done: "detail.researchStatusDone",
  failed: "detail.researchStatusFailed",
  partial: "detail.researchStatusPartial",
  running: "detail.researchStatusRunning",
};

function DirectionList({ directions }: { directions: ExplorationDirection[] }) {
  return (
    <ul className="space-y-2">
      {directions.map((direction) => (
        <li className="space-y-0.5" key={`${direction.query}-${direction.goal}`}>
          {/* Goal leads: it is the human-readable "why this angle". The
              query is the mechanical artifact and stays secondary. */}
          <p className="text-[13px] text-[var(--ir-text-primary)] leading-[1.5]">
            {direction.goal || direction.query}
          </p>
          {direction.goal ? (
            <p className="text-[11px] text-[var(--ir-text-tertiary)]">
              {direction.query}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ExplorationDirections({
  nodeId,
  directions,
}: {
  nodeId: string;
  // The watch's proposed next angles; null until a patrol has run once.
  directions: ExplorationDirection[] | null;
}) {
  const { t } = useLocale();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  // Same SWR key as ResearchSection — SWR dedupes, so opening this board
  // costs no extra request when the research section is already mounted.
  const runsKey = `${basePath}/api/research/runs?nodeId=${encodeURIComponent(nodeId)}`;
  const { data } = useSWR<{ runs: RunRow[] }>(runsKey, fetcher, {
    revalidateOnFocus: false,
  });

  const runs = data?.runs ?? [];
  const tried = runs
    .map((run) => ({
      directions: isExplorationDirectionArray(run.plan) ? run.plan : null,
      run,
    }))
    .filter(
      (entry): entry is { directions: ExplorationDirection[]; run: RunRow } =>
        entry.directions !== null
    );

  // Before the first patrol proposes anything, the most recent run's plan is
  // the honest answer to "what would it look at next" — that is exactly what
  // resolveIntents would reuse (lib/research/patrol.ts).
  const upcoming = directions ?? tried[0]?.directions ?? null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          className="h-7 px-2 text-[12px]"
          data-testid="exploration-directions-trigger"
          size="sm"
          variant="ghost"
        >
          <CompassIcon className="size-3.5" />
          {t("wt.directions")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("wt.directionsTitle")}</DialogTitle>
          <DialogDescription>{t("wt.directionsHint")}</DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <p className="font-semibold text-[11px] text-[var(--ir-text-tertiary)] uppercase tracking-[0.06em]">
            {t("wt.directionsUpcoming")}
          </p>
          {upcoming ? (
            <DirectionList directions={upcoming} />
          ) : (
            <p className="text-[13px] text-[var(--ir-text-tertiary)]">
              {t("wt.directionsEmpty")}
            </p>
          )}
        </section>

        {tried.length > 0 ? (
          <section className="space-y-2 border-[var(--ir-border-default)] border-t pt-3">
            <p className="font-semibold text-[11px] text-[var(--ir-text-tertiary)] uppercase tracking-[0.06em]">
              {t("wt.directionsTried")}
            </p>
            <div className="space-y-3">
              {tried.map((entry) => (
                <div className="space-y-1" key={entry.run.id}>
                  <p className="text-[11px] text-[var(--ir-text-tertiary)]">
                    {new Date(entry.run.createdAt).toLocaleDateString()} ·{" "}
                    {t(RUN_STATUS_KEYS[entry.run.status])}
                  </p>
                  <DirectionList directions={entry.directions} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
