import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  billingPeriodKey,
  billingPeriodRange,
  decideFunding,
  decideWatchAdmission,
  partitionUsageByFunding,
  resolvePlanLimits,
} from "@/lib/billing/plan-core";

const limits = resolvePlanLimits({});

describe("resolvePlanLimits", () => {
  it("uses the documented defaults and honors env overrides", () => {
    assert.deepEqual(limits, {
      monthlyAllowanceUsd: 2,
      maxActiveWatches: 5,
      byokMaxActiveWatches: 20,
    });
    assert.equal(
      resolvePlanLimits({ ZENO_MONTHLY_ALLOWANCE_USD: "7.5" })
        .monthlyAllowanceUsd,
      7.5
    );
    assert.equal(
      resolvePlanLimits({ ZENO_MAX_ACTIVE_WATCHES: "12" }).maxActiveWatches,
      12
    );
  });

  it("falls back rather than trusting junk", () => {
    // A typo'd env var must not silently become an unlimited allowance.
    assert.equal(
      resolvePlanLimits({ ZENO_MONTHLY_ALLOWANCE_USD: "lots" })
        .monthlyAllowanceUsd,
      2
    );
    assert.equal(
      resolvePlanLimits({ ZENO_MAX_ACTIVE_WATCHES: "0" }).maxActiveWatches,
      5
    );
    assert.equal(
      resolvePlanLimits({ ZENO_MAX_ACTIVE_WATCHES: "-4" }).maxActiveWatches,
      5
    );
  });

  it("permits an explicit zero allowance", () => {
    // Turning the free tier off entirely is a legitimate operator choice —
    // unlike a zero watch quota, which would be a typo more often than intent.
    assert.equal(
      resolvePlanLimits({ ZENO_MONTHLY_ALLOWANCE_USD: "0" })
        .monthlyAllowanceUsd,
      0
    );
  });
});

describe("billingPeriodKey", () => {
  it("pads the month and works in UTC", () => {
    assert.equal(billingPeriodKey(new Date("2026-07-26T12:00:00Z")), "2026-07");
    assert.equal(billingPeriodKey(new Date("2026-01-01T00:00:00Z")), "2026-01");
    // 23:00 UTC on the 31st is still December, whatever the viewer's clock says.
    assert.equal(billingPeriodKey(new Date("2026-12-31T23:59:59Z")), "2026-12");
  });
});

describe("billingPeriodRange", () => {
  it("spans first-of-month inclusive to first-of-next exclusive", () => {
    const { start, end } = billingPeriodRange(new Date("2026-07-26T12:00:00Z"));
    assert.equal(start.toISOString(), "2026-07-01T00:00:00.000Z");
    assert.equal(end.toISOString(), "2026-08-01T00:00:00.000Z");
  });

  it("rolls the year over in December", () => {
    const { end } = billingPeriodRange(new Date("2026-12-15T00:00:00Z"));
    assert.equal(end.toISOString(), "2027-01-01T00:00:00.000Z");
  });
});

describe("decideFunding", () => {
  it("routes to the platform while allowance remains", () => {
    const decision = decideFunding({
      hasOwnKey: false,
      spentUsd: 0.5,
      limits,
    });
    assert.equal(decision.source, "platform");
    assert.equal(decision.reason, "within_allowance");
    assert.equal(decision.remainingUsd, 1.5);
  });

  it("denies rather than degrading once the allowance is gone", () => {
    // Not "slower", not "queued", not "a cheaper model" — those are the
    // silent-rationing failure this whole model exists to replace.
    const decision = decideFunding({ hasOwnKey: false, spentUsd: 2, limits });
    assert.equal(decision.source, "denied");
    assert.equal(decision.reason, "allowance_exhausted");
    assert.equal(decision.remainingUsd, 0);
  });

  it("never reports negative remaining after an overshoot", () => {
    // A single run can end above the line; the allowance is checked before a
    // call, not mid-token. Reporting -$3.10 left would be true and useless.
    const decision = decideFunding({ hasOwnKey: false, spentUsd: 5.1, limits });
    assert.equal(decision.remainingUsd, 0);
    assert.equal(decision.source, "denied");
  });

  it("prefers the user's own key even with allowance left", () => {
    const decision = decideFunding({ hasOwnKey: true, spentUsd: 0, limits });
    assert.equal(decision.source, "byok");
    assert.equal(decision.reason, "own_key");
    assert.equal(decision.remainingUsd, 2);
  });

  it("keeps serving a key holder whose allowance is long gone", () => {
    const decision = decideFunding({ hasOwnKey: true, spentUsd: 99, limits });
    assert.equal(decision.source, "byok");
    assert.equal(decision.remainingUsd, 0);
  });

  it("treats an unusable spend figure as zero spent", () => {
    // A NaN from a failed ledger sum must not read as "infinite spend" and
    // lock every user out, nor as a number that compares false with both
    // branches. Fail toward serving, since the meter is the thing at fault.
    const decision = decideFunding({
      hasOwnKey: false,
      spentUsd: Number.NaN,
      limits,
    });
    assert.equal(decision.source, "platform");
    assert.equal(decision.remainingUsd, 2);
  });

  it("denies everyone when the operator sets the allowance to zero", () => {
    const decision = decideFunding({
      hasOwnKey: false,
      spentUsd: 0,
      limits: resolvePlanLimits({ ZENO_MONTHLY_ALLOWANCE_USD: "0" }),
    });
    assert.equal(decision.source, "denied");
  });
});

describe("decideWatchAdmission", () => {
  it("admits below quota and refuses at it", () => {
    assert.equal(
      decideWatchAdmission({ hasOwnKey: false, activeWatches: 4, limits })
        .admitted,
      true
    );
    // 5 active against a quota of 5 means the next one is the sixth.
    const full = decideWatchAdmission({
      hasOwnKey: false,
      activeWatches: 5,
      limits,
    });
    assert.equal(full.admitted, false);
    assert.equal(full.reason, "quota_exhausted");
    assert.equal(full.quota, 5);
  });

  it("gives key holders a bigger quota, not an unlimited one", () => {
    // Their patrols cost the operator nothing but still occupy slots in the
    // one shared daily cron. Unlimited here is the starvation bug wearing a
    // different hat.
    assert.equal(
      decideWatchAdmission({ hasOwnKey: true, activeWatches: 19, limits })
        .admitted,
      true
    );
    const full = decideWatchAdmission({
      hasOwnKey: true,
      activeWatches: 20,
      limits,
    });
    assert.equal(full.admitted, false);
    assert.equal(full.quota, 20);
  });

  it("reports the quota and the count so the caller can say them out loud", () => {
    // Iron Law 2: a refusal the user cannot see is a silent miss. The numbers
    // have to travel with the decision or the message cannot be written.
    const refusal = decideWatchAdmission({
      hasOwnKey: false,
      activeWatches: 9,
      limits,
    });
    assert.equal(refusal.quota, 5);
    assert.equal(refusal.activeWatches, 9);
  });

  it("clamps a nonsense count instead of admitting on it", () => {
    assert.equal(
      decideWatchAdmission({ hasOwnKey: false, activeWatches: -2, limits })
        .activeWatches,
      0
    );
    assert.equal(
      decideWatchAdmission({
        hasOwnKey: false,
        activeWatches: Number.NaN,
        limits,
      }).admitted,
      true
    );
  });
});

describe("partitionUsageByFunding", () => {
  const usage = (inputTokens: number, outputTokens: number) => ({
    inputTokens,
    outputTokens,
  });

  it("splits one run's accumulator between the two payers", () => {
    // The ordinary case, and the reason this function exists: a single
    // research run plans on the user's DeepSeek key and synthesizes on the
    // platform's Anthropic. One funding_source for the whole run would be a
    // lie in one direction or the other.
    const { platform, byok } = partitionUsageByFunding(
      {
        "deepseek-chat": usage(1000, 200),
        "claude-sonnet": usage(4000, 900),
      },
      (key) => key.startsWith("deepseek")
    );

    assert.deepEqual(byok, { "deepseek-chat": usage(1000, 200) });
    assert.deepEqual(platform, { "claude-sonnet": usage(4000, 900) });
  });

  it("leaves the unused side empty rather than zeroed", () => {
    // recordUsage skips an accumulator that sums to zero, so an empty object
    // means no ledger row. A `{model: 0/0}` placeholder would instead write a
    // row of zeroes on every single-payer run — half the ledger, carrying no
    // information, on the hot path.
    const { platform, byok } = partitionUsageByFunding(
      { "deepseek-chat": usage(10, 5) },
      () => true
    );

    assert.deepEqual(platform, {});
    assert.equal(Object.keys(byok).length, 1);
  });

  it("handles a run that spent nothing", () => {
    const { platform, byok } = partitionUsageByFunding({}, () => true);
    assert.deepEqual(platform, {});
    assert.deepEqual(byok, {});
  });

  it("defaults an unrecognized model to the platform", () => {
    // The fail-safe direction. Calling platform tokens `byok` would let real
    // operator spend escape the allowance entirely and never be metered; the
    // reverse over-charges an allowance the user can see and dispute. Between
    // an error that is visible and one that is invisible, take the visible one.
    const { platform, byok } = partitionUsageByFunding(
      { "some-model-nobody-mapped": usage(7, 3) },
      () => false
    );

    assert.deepEqual(platform, { "some-model-nobody-mapped": usage(7, 3) });
    assert.deepEqual(byok, {});
  });

  it("does not mutate the accumulator it was handed", () => {
    // Callers pass the live accumulator a run has been writing into, and
    // settleUsage can be reached from more than one arm of a try/finally.
    const original = {
      "deepseek-chat": usage(1, 1),
      "claude-sonnet": usage(2, 2),
    };
    const snapshot = structuredClone(original);

    partitionUsageByFunding(original, (key) => key.startsWith("deepseek"));

    assert.deepEqual(original, snapshot);
  });
});
