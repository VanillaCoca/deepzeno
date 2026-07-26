import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeNextDueAt,
  evaluatePatrolSignal,
  isBackedOff,
  isWatchWorthy,
  nextQuietPatrols,
  patrolIntervalDays,
  resolvePatrolBudget,
  shouldAlert,
} from "../../lib/research/patrol-core.ts";

describe("computeNextDueAt", () => {
  it("advances by the cadence interval", () => {
    const from = new Date("2026-07-18T00:00:00Z");
    assert.equal(
      computeNextDueAt("daily", from).toISOString(),
      "2026-07-19T00:00:00.000Z"
    );
    assert.equal(
      computeNextDueAt("every_3_days", from).toISOString(),
      "2026-07-21T00:00:00.000Z"
    );
    assert.equal(
      computeNextDueAt("weekly", from).toISOString(),
      "2026-07-25T00:00:00.000Z"
    );
  });

  it("pushes the next visit out once the watch has earned a backoff", () => {
    const from = new Date("2026-07-18T00:00:00Z");
    assert.equal(
      computeNextDueAt("daily", from, 3).toISOString(),
      "2026-07-20T00:00:00.000Z"
    );
  });
});

describe("patrolIntervalDays", () => {
  it("is the plain cadence until the first full step of silence", () => {
    // Below `step` there is one observation, and one observation is noise. A
    // watch must not be slowed by a single quiet day.
    for (const quiet of [0, 1, 2]) {
      assert.equal(patrolIntervalDays("daily", quiet), 1);
      assert.equal(patrolIntervalDays("weekly", quiet), 7);
    }
  });

  it("doubles once per step of consecutive quiet patrols", () => {
    assert.equal(patrolIntervalDays("daily", 3), 2);
    assert.equal(patrolIntervalDays("daily", 5), 2);
    assert.equal(patrolIntervalDays("daily", 6), 4);
    assert.equal(patrolIntervalDays("daily", 9), 8);
    assert.equal(patrolIntervalDays("every_3_days", 3), 6);
  });

  it("caps the interval instead of retiring the watch", () => {
    // The cap is the whole reason a quiet watch can be kept forever: coverage
    // is never silently dropped, it just gets cheap.
    assert.equal(patrolIntervalDays("daily", 300), 30);
    assert.equal(patrolIntervalDays("weekly", 6), 28);
    assert.equal(patrolIntervalDays("weekly", 12), 30);
  });

  it("stays a real number for absurd counts and junk input", () => {
    // A years-quiet watch must not turn into Infinity/NaN and poison
    // next_due_at, which is the column the whole sweep orders by. Junk falls
    // back to "no backoff" rather than to the cap: the failure that costs
    // least is patrolling too often.
    assert.equal(patrolIntervalDays("daily", 1e9), 30);
    assert.equal(patrolIntervalDays("daily", Number.POSITIVE_INFINITY), 1);
    assert.equal(patrolIntervalDays("daily", Number.NaN), 1);
    assert.equal(patrolIntervalDays("daily", -5), 1);
  });
});

describe("nextQuietPatrols", () => {
  it("counts up on quiet and resets on any signal", () => {
    assert.equal(nextQuietPatrols(0, "quiet"), 1);
    assert.equal(nextQuietPatrols(7, "quiet"), 8);
    assert.equal(nextQuietPatrols(7, "signal"), 0);
    assert.equal(nextQuietPatrols(0, "signal"), 0);
  });

  it("leaves the count untouched when the patrol itself failed", () => {
    // The load-bearing case: a dead API key is evidence about the product, not
    // about the world. Counting it as quiet would let one outage back every
    // watch in the deployment off to monthly.
    assert.equal(nextQuietPatrols(4, "failed"), 4);
    assert.equal(nextQuietPatrols(0, "failed"), 0);
  });

  it("repairs a corrupt stored count rather than propagating it", () => {
    assert.equal(nextQuietPatrols(Number.NaN, "quiet"), 1);
    assert.equal(nextQuietPatrols(-3, "quiet"), 1);
  });
});

describe("isBackedOff", () => {
  it("is true exactly when the derived interval exceeds the cadence", () => {
    assert.equal(isBackedOff("daily", 0), false);
    assert.equal(isBackedOff("daily", 2), false);
    assert.equal(isBackedOff("daily", 3), true);
    assert.equal(isBackedOff("weekly", 2), false);
    assert.equal(isBackedOff("weekly", 3), true);
  });
});

describe("evaluatePatrolSignal", () => {
  const priorEvidence = [
    {
      quote: "The cutoff score remains at 480 points.",
      url: "https://a.test/p",
    },
  ];

  it("signals on a fresh contradicting item", () => {
    const result = evaluatePatrolSignal({
      newItems: [
        {
          quote: "The program has been suspended as of June.",
          claim: "Program suspended",
          stance: "contradicts",
        },
      ],
      priorEvidence,
      refetchedPages: [],
    });
    assert.equal(result.signal, true);
    assert.equal(result.kind, "new_contradiction");
    assert.equal(result.detail, "Program suspended");
  });

  it("ignores a contradiction we already knew about (same quote)", () => {
    const result = evaluatePatrolSignal({
      newItems: [
        {
          quote: "The cutoff score REMAINS at   480 points.",
          claim: "Known fact re-extracted",
          stance: "contradicts",
        },
      ],
      priorEvidence,
      refetchedPages: [],
    });
    assert.equal(result.signal, false);
  });

  it("signals when a prior verbatim quote vanished from its page", () => {
    const result = evaluatePatrolSignal({
      newItems: [],
      priorEvidence,
      refetchedPages: [
        { url: "https://a.test/p", text: "Entirely rewritten page content." },
      ],
    });
    assert.equal(result.signal, true);
    assert.equal(result.kind, "quote_vanished");
    assert.equal(result.detail, "https://a.test/p");
  });

  it("stays quiet when the quote still verifies and items support", () => {
    const result = evaluatePatrolSignal({
      newItems: [
        {
          quote: "Anything supportive.",
          claim: "Still true",
          stance: "supports",
        },
      ],
      priorEvidence,
      refetchedPages: [
        {
          url: "https://a.test/p",
          text: "Note: the cutoff score remains at 480 points. More text.",
        },
      ],
    });
    assert.equal(result.signal, false);
  });
});

describe("shouldAlert", () => {
  const now = new Date("2026-07-18T00:00:00Z");

  it("admits when no prior alert and under the weekly cap", () => {
    assert.equal(
      shouldAlert({
        lastAlertAt: null,
        cooldownDays: 7,
        weeklyAlertCount: 0,
        weeklyCap: 3,
        now,
      }),
      true
    );
  });

  it("suppresses inside the cooldown window", () => {
    assert.equal(
      shouldAlert({
        lastAlertAt: "2026-07-15T00:00:00Z",
        cooldownDays: 7,
        weeklyAlertCount: 0,
        weeklyCap: 3,
        now,
      }),
      false
    );
  });

  it("suppresses at the weekly cap regardless of cooldown", () => {
    assert.equal(
      shouldAlert({
        lastAlertAt: null,
        cooldownDays: 7,
        weeklyAlertCount: 3,
        weeklyCap: 3,
        now,
      }),
      false
    );
  });
});

describe("isWatchWorthy", () => {
  it("watches hypotheses with dependents or evidence", () => {
    assert.equal(
      isWatchWorthy({
        kind: "hypothesis",
        hasEvidence: false,
        dependentCount: 2,
      }),
      true
    );
    assert.equal(
      isWatchWorthy({
        kind: "hypothesis",
        hasEvidence: true,
        dependentCount: 0,
      }),
      true
    );
    assert.equal(
      isWatchWorthy({
        kind: "hypothesis",
        hasEvidence: false,
        dependentCount: 0,
      }),
      false
    );
  });

  it("never auto-watches goals, principles, or plans", () => {
    for (const kind of ["goal", "principle", "plan"] as const) {
      assert.equal(
        isWatchWorthy({ kind, hasEvidence: true, dependentCount: 5 }),
        false
      );
    }
  });

  it("watches evidence-backed constraints and questions", () => {
    assert.equal(
      isWatchWorthy({
        kind: "constraint",
        hasEvidence: true,
        dependentCount: 0,
      }),
      true
    );
    assert.equal(
      isWatchWorthy({
        kind: "open_question",
        hasEvidence: false,
        dependentCount: 3,
      }),
      false
    );
  });
});

describe("resolvePatrolBudget", () => {
  it("uses tight defaults and honors env overrides", () => {
    const defaults = resolvePatrolBudget({});
    assert.deepEqual(defaults, {
      maxSearches: 2,
      maxFetches: 3,
      alertCooldownDays: 7,
      weeklyAlertCap: 3,
      maxWatchesPerSweep: 24,
      sweepConcurrency: 4,
      sweepsPerDay: 1,
    });
    assert.equal(
      resolvePatrolBudget({ ZENO_PATROL_MAX_SEARCHES: "5" }).maxSearches,
      5
    );
    assert.equal(
      resolvePatrolBudget({ ZENO_PATROL_MAX_SEARCHES: "junk" }).maxSearches,
      2
    );
    // The concurrency knob is the one an operator reaches for under a
    // rate-limit incident, which is exactly when a silently-ignored typo would
    // cost the most.
    assert.equal(
      resolvePatrolBudget({ ZENO_PATROL_SWEEP_CONCURRENCY: "2" })
        .sweepConcurrency,
      2
    );
    assert.equal(
      resolvePatrolBudget({ ZENO_PATROL_SWEEP_CONCURRENCY: "0" })
        .sweepConcurrency,
      4
    );
  });
});
