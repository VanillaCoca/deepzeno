import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAPACITY_WINDOW,
  estimateSweepCapacity,
} from "../../lib/research/sweep-capacity-core.ts";

const base = { configuredPerSweep: 24, sweepsPerDay: 1 };

describe("estimateSweepCapacity", () => {
  it("falls back to the budget when nothing has been observed", () => {
    const estimate = estimateSweepCapacity({ ...base, observations: [] });
    assert.equal(estimate.source, "configured");
    assert.equal(estimate.perSweep, 24);
    assert.equal(estimate.perDay, 24);
    assert.equal(estimate.samples, 0);
  });

  it("ignores sweeps that finished everything they were handed", () => {
    // These say what the queue was, not what the sweep could do. Counting them
    // would make capacity fall as the backlog clears — lowest exactly when the
    // system is healthiest.
    const estimate = estimateSweepCapacity({
      ...base,
      observations: [
        { processed: 3, deferred: 0 },
        { processed: 5, deferred: 0 },
        { processed: 2, deferred: 0 },
      ],
    });
    assert.equal(estimate.source, "configured");
    assert.equal(estimate.perSweep, 24);
  });

  it("reports the observed ceiling once enough sweeps ran out of clock", () => {
    // The deployment this was written for: budget says 24, reality delivers 8.
    const estimate = estimateSweepCapacity({
      ...base,
      observations: [
        { processed: 8, deferred: 16 },
        { processed: 7, deferred: 17 },
        { processed: 8, deferred: 16 },
        { processed: 8, deferred: 16 },
        { processed: 8, deferred: 16 },
      ],
    });
    assert.equal(estimate.source, "observed");
    assert.equal(estimate.perSweep, 8);
    assert.equal(estimate.perDay, 8);
    assert.equal(estimate.samples, 5);
  });

  it("survives a backfill and an outage without moving", () => {
    // Both tails are real in this deployment's history. A mean over these six
    // would report 36 — higher than the budget, and higher than any sweep
    // except the one that was not a sweep at all.
    const estimate = estimateSweepCapacity({
      ...base,
      observations: [
        { processed: 191, deferred: 40 },
        { processed: 0, deferred: 24 },
        { processed: 8, deferred: 16 },
        { processed: 8, deferred: 16 },
        { processed: 9, deferred: 15 },
        { processed: 8, deferred: 16 },
      ],
    });
    assert.equal(estimate.perSweep, 8);
    assert.equal(estimate.source, "observed");
  });

  it("lets one thin sample lower the estimate but never raise it", () => {
    // Iron Law 2 as arithmetic: overstating capacity hides a miss, understating
    // it shows a warning the next sweeps will correct.
    const slow = estimateSweepCapacity({
      ...base,
      observations: [{ processed: 6, deferred: 18 }],
    });
    assert.equal(slow.source, "observed");
    assert.equal(slow.perSweep, 6);

    const fast = estimateSweepCapacity({
      ...base,
      observations: [{ processed: 40, deferred: 5 }],
    });
    assert.equal(fast.source, "configured");
    assert.equal(fast.perSweep, 24);
  });

  it("multiplies by the number of sweeps a day, not by one", () => {
    const estimate = estimateSweepCapacity({
      configuredPerSweep: 24,
      sweepsPerDay: 4,
      observations: [
        { processed: 8, deferred: 16 },
        { processed: 8, deferred: 16 },
        { processed: 8, deferred: 16 },
      ],
    });
    assert.equal(estimate.perSweep, 8);
    assert.equal(estimate.perDay, 32);
  });

  it("reports a genuinely dead sweep as zero rather than as the budget", () => {
    // Work was waiting and none of it got done. Reporting 24 here would be the
    // exact failure this module exists to prevent.
    const estimate = estimateSweepCapacity({
      ...base,
      observations: [
        { processed: 0, deferred: 24 },
        { processed: 0, deferred: 24 },
        { processed: 0, deferred: 24 },
      ],
    });
    assert.equal(estimate.source, "observed");
    assert.equal(estimate.perSweep, 0);
    assert.equal(estimate.perDay, 0);
  });

  it("looks no further back than the window", () => {
    // A bottleneck fixed last month must not keep dragging the estimate down.
    const stale = Array.from({ length: CAPACITY_WINDOW }, () => ({
      processed: 20,
      deferred: 4,
    }));
    const estimate = estimateSweepCapacity({
      ...base,
      observations: [...stale, { processed: 2, deferred: 22 }],
    });
    assert.equal(estimate.perSweep, 20);
    assert.equal(estimate.samples, CAPACITY_WINDOW);
  });

  it("discards junk rows instead of propagating NaN into the schedule", () => {
    const estimate = estimateSweepCapacity({
      ...base,
      observations: [
        { processed: Number.NaN, deferred: 16 },
        { processed: 8, deferred: Number.POSITIVE_INFINITY },
        { processed: 8, deferred: 16 },
        { processed: 8, deferred: 16 },
        { processed: 8, deferred: 16 },
      ],
    });
    assert.equal(estimate.perSweep, 8);
    assert.equal(estimate.samples, 3);
  });

  it("rounds an even split down", () => {
    const estimate = estimateSweepCapacity({
      ...base,
      observations: [
        { processed: 7, deferred: 17 },
        { processed: 8, deferred: 16 },
        { processed: 9, deferred: 15 },
        { processed: 10, deferred: 14 },
      ],
    });
    assert.equal(estimate.perSweep, 8);
  });
});
