import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeNextDueAt,
  evaluatePatrolSignal,
  isWatchWorthy,
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
      maxWatchesPerSweep: 8,
    });
    assert.equal(
      resolvePatrolBudget({ ZENO_PATROL_MAX_SEARCHES: "5" }).maxSearches,
      5
    );
    assert.equal(
      resolvePatrolBudget({ ZENO_PATROL_MAX_SEARCHES: "junk" }).maxSearches,
      2
    );
  });
});
