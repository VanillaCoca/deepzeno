/**
 * The progress model for ZENO's long-running agent work.
 *
 * Pure and side-effect free so `tests/unit/run-progress-core.test.ts` can
 * import it directly; the server writes these shapes into `research_run.progress`
 * and the activity bar reads them back.
 *
 * Two rules run through the whole module, and both are Iron Law 2 (宁漏勿错)
 * applied to a progress indicator:
 *
 *   1. A percentage is only ever computed against a denominator that actually
 *      exists — the per-run budget the user can inspect. A phase with no
 *      denominator reports `null`, which the UI must render as an
 *      indeterminate segment. It must never fall back to 0, to a guess, or to
 *      wall-clock extrapolation: a fabricated 73% is a fabricated truth, and
 *      it is worse than no number because the user schedules around it.
 *
 *   2. A run only fills its whole rail when it finished cleanly. Partial,
 *      cancelled and failed runs freeze at the phase they reached. A bar that
 *      reaches the end and then says "partial" has already told the lie.
 */

export const RUN_TYPES = ["research", "patrol", "sweep"] as const;
export type RunType = (typeof RUN_TYPES)[number];

export const RUN_PHASES = [
  "plan",
  "collect",
  "judge",
  "land",
  "extract",
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/**
 * The known phases of each run type, in order. This is the honest denominator
 * the whole design rests on: we do not know how long a run takes, but we do
 * know how many phases it has and which one it is in.
 *
 * Sweep gets a single phase because it genuinely is one model call. Giving it
 * a four-segment rail to look consistent would be inventing structure.
 */
export const PHASE_RAIL: Record<RunType, readonly RunPhase[]> = {
  research: ["plan", "collect", "judge", "land"],
  patrol: ["plan", "collect", "judge", "land"],
  sweep: ["extract"],
};

export type RunCounter = { used: number; max: number };

export type RunProgress = {
  phase: RunPhase;
  /** Web searches spent against `budget.maxSearches`. */
  searches?: RunCounter;
  /** Page fetches spent against `budget.maxFetches`. */
  fetches?: RunCounter;
  /** Quote-verified evidence rows so far. A count, not a fraction. */
  evidence?: number;
  /** Candidates landed so far. A count, not a fraction. */
  candidates?: number;
  /** Running cost estimate in USD at this checkpoint. */
  cost?: number;
  /** ISO timestamp of this checkpoint — the input to staleness detection. */
  at?: string;
};

export type RunStatus =
  | "running"
  | "cancelling"
  | "cancelled"
  | "done"
  | "partial"
  | "failed";

export const ACTIVE_RUN_STATUSES = ["running", "cancelling"] as const;

export function isActiveRunStatus(status: string): boolean {
  return status === "running" || status === "cancelling";
}

/**
 * A run whose last checkpoint is older than this is reported as lost contact.
 *
 * This is not cosmetic. Research runs execute inside one serverless
 * invocation with a 300s ceiling; if that invocation is killed the row stays
 * `running` forever and nothing ever corrects it. Without this the activity
 * bar would spin on a dead run indefinitely, which is precisely the anxiety
 * the bar exists to remove. Checkpoints are written at every phase boundary
 * and every search/fetch, so a live run refreshes far more often than this.
 */
export const RUN_STALE_SECONDS = 150;

/**
 * The longest a run can still have a process behind it, measured from the
 * moment its row was written.
 *
 * This is not a heuristic like the number above it. A run executes inside one
 * serverless invocation, and the longest ceiling any of our run routes
 * declares is 300s — so an invocation that began when the row was inserted
 * cannot still be executing once that ceiling has passed. A row still marked
 * `running` past this point is not slow; it is orphaned, and the 30s of slack
 * covers the gap between the insert and the invocation's own clock.
 *
 * The two thresholds are deliberately far apart because they answer different
 * questions. Staleness is a warning the UI draws and takes back the instant a
 * checkpoint lands. This one writes a terminal status into the database, which
 * nothing takes back. Warning early is cheap; declaring a run dead early is
 * not.
 */
export const RUN_MAX_LIFETIME_SECONDS = 330;

/**
 * Terminal states in which the rail must NOT be shown as complete.
 *
 * Exported because the UI owes these runs an explanation, not just a colour:
 * a `partial` run must say what it dropped, a `failed` run must keep its error.
 */
export const INCOMPLETE_TERMINAL_STATUSES: readonly RunStatus[] = [
  "partial",
  "cancelled",
  "failed",
];

export function isIncompleteTerminalStatus(status: string): boolean {
  return (INCOMPLETE_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export type RunRecord = {
  id: string;
  runType: RunType;
  status: RunStatus;
  /** Human label — origin node title, watch subject, or a sweep caption. */
  label: string;
  progress: RunProgress | null;
  /** Final cost, written when the run ends. */
  costEstimate: number | null;
  createdAt: string;
  finishedAt: string | null;
};

export type RunView = {
  id: string;
  runType: RunType;
  status: RunStatus;
  label: string;
  rail: readonly RunPhase[];
  /** Index of the current phase in the rail; -1 when no checkpoint landed. */
  phaseIndex: number;
  /** Segments to render as fully complete. */
  completedPhases: number;
  /**
   * Fill ratio of the current segment in [0, 1], or null when this phase has
   * no denominator. `null` means "render indeterminate", never "render 0%".
   */
  phaseFill: number | null;
  /** The raw counter behind `phaseFill`, so the UI can print "7/16". */
  phaseCounter: RunCounter | null;
  elapsedSeconds: number;
  /** Running or final cost in USD; null when nothing has been spent yet. */
  cost: number | null;
  /** True when an in-flight run has stopped checkpointing (see above). */
  stale: boolean;
  active: boolean;
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value > 1 ? 1 : value;
}

export type AbandonedRunInput = {
  status: string;
  createdAt: string;
  progress: RunProgress | null;
};

export type RunSettlement = {
  status: RunStatus;
  /** Written to `research_run.error`; null when nothing went wrong. */
  error: string | null;
};

/**
 * How a run that lost its process should be settled, or null if it is still
 * entitled to be running.
 *
 * The bar exists because the previous design had none: a killed invocation
 * left `running` in the row forever, the activity bar honestly reported "lost
 * contact", and nothing on either side ever resolved the contradiction. The
 * client had already concluded the run was dead; the database still claimed
 * otherwise, and the database is what every other decision reads. Pressing
 * cancel did not help either — that only moves `running` to `cancelling`,
 * which is equally active and equally unattended.
 *
 * Which terminal state it gets is the same distinction the pipeline itself
 * draws. A run that landed something before it died is `partial`, because
 * discarding the evidence it did collect would throw away work the user paid
 * for. A run that landed nothing is `failed`. A run that was already
 * cancelling is `cancelled` with no error, because the user asked it to stop
 * and it is stopped — Iron Law 2 forbids reporting a failure that did not
 * happen just as firmly as it forbids reporting a success that did not.
 */
export function settlementForAbandonedRun(
  run: AbandonedRunInput,
  nowMs: number
): RunSettlement | null {
  if (!isActiveRunStatus(run.status)) {
    return null;
  }

  const startedMs = parseTime(run.createdAt);

  // An unparseable created_at is the one case where we cannot prove anything,
  // and an unprovable death is not a death. Leave the row alone.
  if (
    startedMs === null ||
    (nowMs - startedMs) / 1000 <= RUN_MAX_LIFETIME_SECONDS
  ) {
    return null;
  }

  if (run.status === "cancelling") {
    return { status: "cancelled", error: null };
  }

  const landed =
    (run.progress?.evidence ?? 0) > 0 || (run.progress?.candidates ?? 0) > 0;
  const phase = run.progress?.phase;

  return {
    status: landed ? "partial" : "failed",
    error: `Lost contact${phase ? ` during ${phase}` : ""}: the run's invocation ended before it could finish.`,
  };
}

/**
 * The denominator for the current phase, or null when there isn't one.
 *
 * Collect is the only phase with a real budget, and it spends two budgets at
 * once (searches then fetches). They are summed rather than averaged because
 * the user's ceiling is the pair — "6 searches and 10 fetches" is one
 * allowance of 16 units, and the bar should track the allowance.
 */
export function phaseCounterOf(
  progress: RunProgress | null
): RunCounter | null {
  if (!progress) {
    return null;
  }

  const parts = [progress.searches, progress.fetches].filter(
    (counter): counter is RunCounter =>
      Boolean(counter) &&
      Number.isFinite(counter?.max) &&
      (counter?.max ?? 0) > 0
  );

  if (parts.length === 0) {
    return null;
  }

  return {
    used: parts.reduce((sum, counter) => sum + Math.max(0, counter.used), 0),
    max: parts.reduce((sum, counter) => sum + counter.max, 0),
  };
}

export function summarizeRun({
  run,
  nowMs,
}: {
  run: RunRecord;
  nowMs: number;
}): RunView {
  const rail = PHASE_RAIL[run.runType] ?? PHASE_RAIL.research;
  const progress = run.progress ?? null;
  const active = isActiveRunStatus(run.status);

  const phaseIndex = progress ? rail.indexOf(progress.phase) : -1;

  // A clean finish fills the rail. Every other state — in-flight, and the three
  // incomplete terminal states — freezes at the phase it actually reached, so
  // "partial" never reads as "complete".
  const completedPhases =
    run.status === "done" ? rail.length : Math.max(0, phaseIndex);

  const phaseCounter = active ? phaseCounterOf(progress) : null;
  const phaseFill = phaseCounter
    ? clampRatio(phaseCounter.used / phaseCounter.max)
    : null;

  const startedMs = parseTime(run.createdAt) ?? nowMs;
  const endedMs = parseTime(run.finishedAt);
  const elapsedSeconds = Math.max(
    0,
    Math.round(((active ? nowMs : (endedMs ?? nowMs)) - startedMs) / 1000)
  );

  const lastBeatMs = parseTime(progress?.at) ?? startedMs;
  const stale = active && (nowMs - lastBeatMs) / 1000 > RUN_STALE_SECONDS;

  const cost = run.costEstimate ?? progress?.cost ?? null;

  return {
    id: run.id,
    runType: run.runType,
    status: run.status,
    label: run.label,
    rail,
    phaseIndex,
    completedPhases,
    phaseFill,
    phaseCounter,
    elapsedSeconds,
    cost: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    stale,
    active,
  };
}

/**
 * Ordering for the activity bar.
 *
 * A run that lost contact sorts first: it is the only one the user can do
 * anything about. After that, longest-running first — the run that has cost
 * the most and is closest to the invocation ceiling. `id` breaks ties so the
 * order never flickers between polls.
 */
export function rankRunViews(views: RunView[]): RunView[] {
  return [...views].sort((a, b) => {
    if (a.stale !== b.stale) {
      return a.stale ? -1 : 1;
    }

    if (a.elapsedSeconds !== b.elapsedSeconds) {
      return b.elapsedSeconds - a.elapsedSeconds;
    }

    return a.id.localeCompare(b.id);
  });
}

export type ActivitySummary = {
  active: RunView[];
  headline: RunView | null;
  othersCount: number;
  totalCost: number | null;
};

export function summarizeActivity({
  runs,
  nowMs,
}: {
  runs: RunRecord[];
  nowMs: number;
}): ActivitySummary {
  const active = rankRunViews(
    runs
      .filter((run) => isActiveRunStatus(run.status))
      .map((run) => summarizeRun({ run, nowMs }))
  );

  const costs = active
    .map((view) => view.cost)
    .filter((cost): cost is number => typeof cost === "number");

  return {
    active,
    headline: active[0] ?? null,
    othersCount: Math.max(0, active.length - 1),
    // Omitted rather than zeroed when no run has reported a cost yet: "$0.00"
    // and "not measured yet" are different claims.
    totalCost:
      costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0),
  };
}

/**
 * The pre-run cost anchor.
 *
 * Deliberately the median of what this project's own comparable runs actually
 * cost, not a model-priced forecast. A forecast would multiply a made-up token
 * count by a price table and present the product as a number; the median is a
 * measurement. When there is no history the caller gets null and must say so
 * rather than show a placeholder.
 */
export function medianCost(
  costs: Array<number | null | undefined>
): number | null {
  const values = costs
    .filter((cost): cost is number => typeof cost === "number" && cost > 0)
    .sort((a, b) => a - b);

  if (values.length === 0) {
    return null;
  }

  const middle = Math.floor(values.length / 2);

  return values.length % 2 === 1
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

/** Compact, locale-neutral elapsed time: "42s", "4m 39s", "1h 04m". */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  }

  const hours = Math.floor(seconds / 3600);
  return `${hours}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

/** Cost in USD at a fixed precision. Sub-cent runs are common. */
export function formatCost(cost: number): string {
  return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`;
}

/**
 * Budget bounds for a user-edited pre-run budget.
 *
 * The ceiling is not a safety rail against the user; it is the ceiling one
 * serverless invocation can actually finish inside. Letting the user ask for
 * 50 searches would produce a run that always dies at 300s and always reports
 * partial — an editable field whose values silently cannot work is worse than
 * no field.
 */
export const BUDGET_BOUNDS = {
  maxSearches: { min: 1, max: 12 },
  maxFetches: { min: 1, max: 20 },
} as const;

export function clampBudgetOverride(input: {
  maxSearches?: number | null;
  maxFetches?: number | null;
}): { maxSearches?: number; maxFetches?: number } {
  const result: { maxSearches?: number; maxFetches?: number } = {};

  for (const key of ["maxSearches", "maxFetches"] as const) {
    const raw = input[key];

    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      continue;
    }

    const bounds = BUDGET_BOUNDS[key];
    result[key] = Math.min(bounds.max, Math.max(bounds.min, Math.round(raw)));
  }

  return result;
}
