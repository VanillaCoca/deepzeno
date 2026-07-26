import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AbandonedRunInput,
  BUDGET_BOUNDS,
  clampBudgetOverride,
  formatCost,
  formatElapsed,
  isActiveRunStatus,
  isIncompleteTerminalStatus,
  medianCost,
  PHASE_RAIL,
  phaseCounterOf,
  RUN_MAX_LIFETIME_SECONDS,
  RUN_STALE_SECONDS,
  type RunProgress,
  type RunRecord,
  rankRunViews,
  settlementForAbandonedRun,
  summarizeActivity,
  summarizeRun,
} from "../../lib/research/run-progress-core.ts";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function at(secondsAgo: number): string {
  return new Date(NOW - secondsAgo * 1000).toISOString();
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    runType: "research",
    status: "running",
    label: "Why does Bedrock route GPT-5 through the Responses API?",
    progress: null,
    costEstimate: null,
    createdAt: at(60),
    finishedAt: null,
    ...overrides,
  } satisfies RunRecord;
}

function progress(overrides: Partial<RunProgress> = {}): RunProgress {
  return { phase: "collect", at: at(5), ...overrides } satisfies RunProgress;
}

describe("phaseCounterOf", () => {
  it("returns null when the phase has no denominator", () => {
    // Plan, judge and land spend no budget. There is nothing to divide by, and
    // the caller must render indeterminate rather than invent a fraction.
    assert.equal(phaseCounterOf(progress({ phase: "plan" })), null);
    assert.equal(phaseCounterOf(null), null);
  });

  it("sums the two collect budgets into one allowance", () => {
    // "6 searches and 10 fetches" is one ceiling of 16 units, not two bars to
    // average. Averaging would report 50% after spending all 6 searches.
    const counter = phaseCounterOf(
      progress({
        searches: { used: 6, max: 6 },
        fetches: { used: 1, max: 10 },
      })
    );

    assert.deepEqual(counter, { used: 7, max: 16 });
  });

  it("ignores a counter whose max is zero or missing", () => {
    // A zero denominator is not a budget; dividing by it would produce
    // Infinity and a full bar on a run that has done nothing.
    const counter = phaseCounterOf(
      progress({
        searches: { used: 0, max: 0 },
        fetches: { used: 2, max: 10 },
      })
    );

    assert.deepEqual(counter, { used: 2, max: 10 });
  });
});

describe("summarizeRun · the rail", () => {
  it("fills the whole rail only on a clean finish", () => {
    const view = summarizeRun({
      run: run({
        status: "done",
        progress: progress({ phase: "land" }),
        finishedAt: at(0),
      }),
      nowMs: NOW,
    });

    assert.equal(view.completedPhases, PHASE_RAIL.research.length);
  });

  for (const status of ["partial", "cancelled", "failed"] as const) {
    it(`freezes a ${status} run at the phase it reached`, () => {
      // A bar that runs to the end and then labels itself "partial" has
      // already told the lie the label is trying to correct.
      const view = summarizeRun({
        run: run({
          status,
          progress: progress({ phase: "judge" }),
          finishedAt: at(0),
        }),
        nowMs: NOW,
      });

      assert.equal(view.phaseIndex, 2);
      assert.equal(view.completedPhases, 2);
      assert.notEqual(view.completedPhases, PHASE_RAIL.research.length);
    });
  }

  it("reports phaseIndex -1 and no completed phases before the first checkpoint", () => {
    const view = summarizeRun({ run: run({ progress: null }), nowMs: NOW });

    assert.equal(view.phaseIndex, -1);
    assert.equal(view.completedPhases, 0);
    assert.equal(view.phaseFill, null);
  });

  it("gives sweep a one-segment rail rather than a padded four", () => {
    const view = summarizeRun({
      run: run({ runType: "sweep", progress: progress({ phase: "extract" }) }),
      nowMs: NOW,
    });

    assert.deepEqual(view.rail, ["extract"]);
    assert.equal(view.phaseIndex, 0);
  });
});

describe("summarizeRun · phaseFill", () => {
  it("is null, never 0, for a phase with no denominator", () => {
    // The distinction the whole module exists for: 0 means "measured, nothing
    // spent"; null means "no denominator exists, render indeterminate".
    const view = summarizeRun({
      run: run({ progress: progress({ phase: "plan" }) }),
      nowMs: NOW,
    });

    assert.equal(view.phaseFill, null);
    assert.equal(view.phaseCounter, null);
  });

  it("is a real ratio once collect reports its budgets", () => {
    const view = summarizeRun({
      run: run({
        progress: progress({
          searches: { used: 2, max: 6 },
          fetches: { used: 2, max: 10 },
        }),
      }),
      nowMs: NOW,
    });

    assert.deepEqual(view.phaseCounter, { used: 4, max: 16 });
    assert.equal(view.phaseFill, 0.25);
  });

  it("clamps an over-budget counter to 1 instead of overflowing the segment", () => {
    const view = summarizeRun({
      run: run({
        progress: progress({ searches: { used: 9, max: 6 } }),
      }),
      nowMs: NOW,
    });

    assert.equal(view.phaseFill, 1);
  });

  it("drops the fill on a finished run", () => {
    // A terminal run's segment is drawn by status, not by a stale mid-run
    // counter that would leave a half-filled bar next to "done".
    const view = summarizeRun({
      run: run({
        status: "partial",
        progress: progress({ searches: { used: 3, max: 6 } }),
        finishedAt: at(0),
      }),
      nowMs: NOW,
    });

    assert.equal(view.phaseFill, null);
    assert.equal(view.phaseCounter, null);
  });
});

describe("summarizeRun · staleness", () => {
  it("flags an in-flight run whose checkpoints stopped", () => {
    // A killed serverless invocation leaves the row `running` forever. Without
    // this the bar spins on a dead run — exactly the anxiety it exists to end.
    const view = summarizeRun({
      run: run({
        createdAt: at(RUN_STALE_SECONDS + 120),
        progress: progress({ at: at(RUN_STALE_SECONDS + 30) }),
      }),
      nowMs: NOW,
    });

    assert.equal(view.stale, true);
  });

  it("does not flag a run that checkpointed recently", () => {
    const view = summarizeRun({
      run: run({ progress: progress({ at: at(RUN_STALE_SECONDS - 10) }) }),
      nowMs: NOW,
    });

    assert.equal(view.stale, false);
  });

  it("never flags a finished run", () => {
    const view = summarizeRun({
      run: run({
        status: "done",
        createdAt: at(9999),
        progress: progress({ at: at(9000) }),
        finishedAt: at(8900),
      }),
      nowMs: NOW,
    });

    assert.equal(view.stale, false);
  });

  it("falls back to the start time when no checkpoint has landed", () => {
    // A run that never wrote a single checkpoint is the most likely to be
    // dead, so silence since creation must count against it.
    const view = summarizeRun({
      run: run({ createdAt: at(RUN_STALE_SECONDS + 5), progress: null }),
      nowMs: NOW,
    });

    assert.equal(view.stale, true);
  });
});

describe("summarizeRun · elapsed and cost", () => {
  it("counts an in-flight run up to now and a finished run to its end", () => {
    const live = summarizeRun({ run: run({ createdAt: at(75) }), nowMs: NOW });
    assert.equal(live.elapsedSeconds, 75);

    const ended = summarizeRun({
      run: run({ status: "done", createdAt: at(300), finishedAt: at(60) }),
      nowMs: NOW,
    });
    assert.equal(ended.elapsedSeconds, 240);
  });

  it("prefers the settled cost over the mid-run checkpoint estimate", () => {
    const view = summarizeRun({
      run: run({
        status: "done",
        costEstimate: 0.0412,
        progress: progress({ cost: 0.021 }),
        finishedAt: at(0),
      }),
      nowMs: NOW,
    });

    assert.equal(view.cost, 0.0412);
  });

  it("reports null rather than 0 when nothing has been spent yet", () => {
    const view = summarizeRun({ run: run(), nowMs: NOW });

    assert.equal(view.cost, null);
  });
});

describe("rankRunViews", () => {
  it("puts a lost-contact run first, then the longest-running", () => {
    // The stale run is the only one the user can act on; everything else is
    // just waiting.
    const views = [
      summarizeRun({ run: run({ id: "b", createdAt: at(30) }), nowMs: NOW }),
      summarizeRun({
        run: run({
          id: "c",
          createdAt: at(RUN_STALE_SECONDS + 60),
          progress: progress({ at: at(RUN_STALE_SECONDS + 30) }),
        }),
        nowMs: NOW,
      }),
      summarizeRun({ run: run({ id: "a", createdAt: at(120) }), nowMs: NOW }),
    ];

    assert.deepEqual(
      rankRunViews(views).map((view) => view.id),
      ["c", "a", "b"]
    );
  });

  it("breaks ties by id so the order does not flicker between polls", () => {
    const views = ["z", "a", "m"].map((id) =>
      summarizeRun({ run: run({ id, createdAt: at(40) }), nowMs: NOW })
    );

    assert.deepEqual(
      rankRunViews(views).map((view) => view.id),
      ["a", "m", "z"]
    );
  });
});

describe("summarizeActivity", () => {
  it("keeps only in-flight runs and counts the ones behind the headline", () => {
    const summary = summarizeActivity({
      runs: [
        run({ id: "a", createdAt: at(200) }),
        run({ id: "b", status: "cancelling", createdAt: at(20) }),
        run({ id: "c", status: "done", finishedAt: at(5) }),
      ],
      nowMs: NOW,
    });

    assert.equal(summary.active.length, 2);
    assert.equal(summary.headline?.id, "a");
    assert.equal(summary.othersCount, 1);
  });

  it("returns an empty summary when nothing is running", () => {
    const summary = summarizeActivity({
      runs: [run({ status: "failed", finishedAt: at(30) })],
      nowMs: NOW,
    });

    assert.deepEqual(summary.active, []);
    assert.equal(summary.headline, null);
    assert.equal(summary.othersCount, 0);
    assert.equal(summary.totalCost, null);
  });

  it("reports totalCost as null rather than 0 when no run has priced itself", () => {
    // "$0.00" claims the run is free. "not measured yet" is the truth.
    const summary = summarizeActivity({
      runs: [run({ id: "a" }), run({ id: "b" })],
      nowMs: NOW,
    });

    assert.equal(summary.totalCost, null);
  });

  it("sums what the in-flight runs have actually reported", () => {
    const summary = summarizeActivity({
      runs: [
        run({ id: "a", progress: progress({ cost: 0.01 }) }),
        run({ id: "b", progress: progress({ cost: 0.02 }) }),
        run({ id: "c" }),
      ],
      nowMs: NOW,
    });

    assert.equal(summary.totalCost, 0.03);
  });
});

describe("medianCost", () => {
  it("returns null with no usable history", () => {
    // No history means no anchor. The caller must say so, not show a zero.
    assert.equal(medianCost([]), null);
    assert.equal(medianCost([null, undefined, 0]), null);
  });

  it("takes the middle of an odd sample and the mean of the middle two", () => {
    assert.equal(medianCost([0.03, 0.01, 0.02]), 0.02);
    assert.equal(medianCost([0.04, 0.02]), 0.03);
  });

  it("is unmoved by one runaway run", () => {
    // The reason it is a median and not a mean: a single 300s run that burned
    // its whole budget must not become the number quoted before every run.
    assert.equal(medianCost([0.01, 0.012, 0.011, 0.013, 4.2]), 0.012);
  });
});

describe("formatElapsed", () => {
  it("renders the three magnitudes", () => {
    assert.equal(formatElapsed(42), "42s");
    assert.equal(formatElapsed(279), "4m 39s");
    assert.equal(formatElapsed(3840), "1h 04m");
  });

  it("never renders a negative clock", () => {
    assert.equal(formatElapsed(-5), "0s");
  });
});

describe("formatCost", () => {
  it("keeps enough digits for a sub-cent run to be visible", () => {
    // Most runs cost well under a cent; two decimals would print every one of
    // them as "$0.00" and the meter would read as broken.
    assert.equal(formatCost(0.0042), "$0.0042");
    assert.equal(formatCost(0.137), "$0.137");
  });
});

describe("clampBudgetOverride", () => {
  it("clamps to what one invocation can actually finish", () => {
    const clamped = clampBudgetOverride({ maxSearches: 50, maxFetches: 0 });

    assert.equal(clamped.maxSearches, BUDGET_BOUNDS.maxSearches.max);
    assert.equal(clamped.maxFetches, BUDGET_BOUNDS.maxFetches.min);
  });

  it("rounds a fractional request", () => {
    assert.deepEqual(clampBudgetOverride({ maxSearches: 4.6 }), {
      maxSearches: 5,
    });
  });

  it("drops non-numeric and non-finite input instead of defaulting it", () => {
    // An omitted key must stay omitted so the server falls back to the real
    // default; coercing NaN to a bound would silently rewrite the budget.
    assert.deepEqual(
      clampBudgetOverride({ maxSearches: Number.NaN, maxFetches: null }),
      {}
    );
  });
});

describe("status predicates", () => {
  it("treats cancelling as still in flight", () => {
    // The pipeline only reads the cancel flag at a phase boundary, so a
    // cancelling run is still burning budget and must stay on the bar.
    assert.equal(isActiveRunStatus("cancelling"), true);
    assert.equal(isActiveRunStatus("running"), true);
    assert.equal(isActiveRunStatus("cancelled"), false);
    assert.equal(isActiveRunStatus("done"), false);
  });

  it("marks the terminal states that owe the user an explanation", () => {
    assert.equal(isIncompleteTerminalStatus("partial"), true);
    assert.equal(isIncompleteTerminalStatus("cancelled"), true);
    assert.equal(isIncompleteTerminalStatus("failed"), true);
    assert.equal(isIncompleteTerminalStatus("done"), false);
    assert.equal(isIncompleteTerminalStatus("running"), false);
  });
});

describe("settlementForAbandonedRun", () => {
  function abandoned(
    overrides: Partial<AbandonedRunInput> = {}
  ): AbandonedRunInput {
    return {
      status: "running",
      createdAt: at(RUN_MAX_LIFETIME_SECONDS + 1),
      progress: null,
      ...overrides,
    } satisfies AbandonedRunInput;
  }

  it("leaves a run alone while it could still be executing", () => {
    // The whole safety argument rests on this: the threshold is above every
    // route's maxDuration, so anything younger may well be mid-collect and
    // about to write its own verdict.
    assert.equal(
      settlementForAbandonedRun(abandoned({ createdAt: at(30) }), NOW),
      null
    );
  });

  it("holds its fire exactly at the threshold and settles one second past it", () => {
    assert.equal(
      settlementForAbandonedRun(
        abandoned({ createdAt: at(RUN_MAX_LIFETIME_SECONDS) }),
        NOW
      ),
      null
    );
    assert.equal(
      settlementForAbandonedRun(
        abandoned({ createdAt: at(RUN_MAX_LIFETIME_SECONDS + 1) }),
        NOW
      )?.status,
      "failed"
    );
  });

  it("calls an orphaned run that produced nothing a failure, and says where it died", () => {
    const settlement = settlementForAbandonedRun(
      abandoned({ progress: { phase: "collect" } as RunProgress }),
      NOW
    );

    assert.equal(settlement?.status, "failed");
    assert.match(settlement?.error ?? "", /collect/);
  });

  it("calls it partial when anything actually landed", () => {
    // Evidence rows and candidate nodes are already in the database; burying
    // the run as `failed` would tell the user to disregard work they have.
    assert.equal(
      settlementForAbandonedRun(
        abandoned({ progress: { phase: "judge", evidence: 4 } as RunProgress }),
        NOW
      )?.status,
      "partial"
    );
    assert.equal(
      settlementForAbandonedRun(
        abandoned({
          progress: {
            phase: "land",
            evidence: 0,
            candidates: 2,
          } as RunProgress,
        }),
        NOW
      )?.status,
      "partial"
    );
  });

  it("settles an abandoned cancelling run as cancelled, with no error", () => {
    // The user asked for this. A cancelled run is not a failed run, and
    // writing an error onto it would put a red mark on their own decision.
    const settlement = settlementForAbandonedRun(
      abandoned({
        status: "cancelling",
        progress: { phase: "collect", evidence: 3 } as RunProgress,
      }),
      NOW
    );

    assert.deepEqual(settlement, { status: "cancelled", error: null });
  });

  it("never touches a run that already reached a verdict of its own", () => {
    for (const status of ["done", "partial", "cancelled", "failed"]) {
      assert.equal(
        settlementForAbandonedRun(
          abandoned({ status, createdAt: at(999_999) }),
          NOW
        ),
        null,
        `${status} must be left alone`
      );
    }
  });

  it("leaves a run alone when its age cannot be established", () => {
    // An unprovable death is not a death. Without a parsable timestamp there
    // is no argument that the invocation is gone, only a suspicion.
    assert.equal(
      settlementForAbandonedRun(abandoned({ createdAt: "not a date" }), NOW),
      null
    );
  });
});
