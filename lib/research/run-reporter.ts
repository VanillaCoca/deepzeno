import "server-only";

import {
  getResearchRunStatus,
  writeRunCheckpoint,
} from "@/lib/research/queries";
import type { RunPhase, RunProgress } from "@/lib/research/run-progress-core";

/**
 * Thrown when the user asked a run to stop and the run reached a point where
 * stopping is clean.
 *
 * A distinct error type rather than a generic one because a cancelled run is
 * not a failed run: it has no error to report and nothing went wrong. Callers
 * settle it as `cancelled`, which the UI must not draw as a completed rail.
 */
export class RunCancelledError extends Error {
  constructor(message = "Run cancelled by the user") {
    super(message);
    this.name = "RunCancelledError";
  }
}

export type RunUpdate = {
  phase: RunPhase;
  searchesUsed?: number;
  fetchesUsed?: number;
  evidence?: number;
  candidates?: number;
};

export type RunReporter = {
  /**
   * Report where the run is and how much of its budget it has spent, and
   * check the cancel flag in the same round trip. Throws RunCancelledError if
   * the user has asked it to stop.
   */
  beat: (update: RunUpdate) => Promise<void>;
  /**
   * Report progress without honouring a cancel.
   *
   * For work whose cost is already sunk. Cancelling means "stop spending my
   * money", not "throw away what you already bought" — once judging has
   * produced candidates, landing them costs nothing more, and discarding them
   * would make cancel a destructive act the user did not ask for.
   */
  report: (update: RunUpdate) => Promise<void>;
  /** Cancel check with no progress to report — used before the first beat. */
  checkCancelled: () => Promise<void>;
};

/**
 * The progress channel for one run.
 *
 * The budget is captured here rather than passed per beat because the
 * denominator has to travel with every checkpoint: the UI must be able to
 * render "4 / 6 searches" from the stored row alone, without re-deriving what
 * the budget was when the run started (env defaults can change between a run
 * starting and someone looking at it).
 */
export function createRunReporter({
  runId,
  budget,
  costEstimate,
}: {
  runId: string;
  budget: { maxSearches: number; maxFetches: number };
  /** Running cost in USD at the moment of the beat. Null when unpriced. */
  costEstimate: () => number | null;
}): RunReporter {
  let cancelled = false;

  function raiseIfCancelled(status: string | null) {
    if (status === "cancelling" || status === "cancelled") {
      cancelled = true;
      throw new RunCancelledError();
    }
  }

  function buildProgress(update: RunUpdate): RunProgress {
    const cost = costEstimate();

    return {
      phase: update.phase,
      at: new Date().toISOString(),
      ...(update.searchesUsed === undefined
        ? {}
        : { searches: { used: update.searchesUsed, max: budget.maxSearches } }),
      ...(update.fetchesUsed === undefined
        ? {}
        : { fetches: { used: update.fetchesUsed, max: budget.maxFetches } }),
      ...(update.evidence === undefined ? {} : { evidence: update.evidence }),
      ...(update.candidates === undefined
        ? {}
        : { candidates: update.candidates }),
      ...(cost === null ? {} : { cost }),
    };
  }

  return {
    async beat(update) {
      if (cancelled) {
        throw new RunCancelledError();
      }

      raiseIfCancelled(
        await writeRunCheckpoint({
          id: runId,
          progress: buildProgress(update),
        })
      );
    },

    async report(update) {
      await writeRunCheckpoint({ id: runId, progress: buildProgress(update) });
    },

    async checkCancelled() {
      if (cancelled) {
        throw new RunCancelledError();
      }

      raiseIfCancelled(await getResearchRunStatus({ id: runId }));
    },
  };
}
