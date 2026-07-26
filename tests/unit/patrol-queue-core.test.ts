import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCadenceHonored,
  realizedIntervalDays,
  summarizePatrolQueue,
} from "../../lib/research/patrol-queue-core.ts";

describe("summarizePatrolQueue", () => {
  it("reports no derived cycle while the queue keeps up", () => {
    // Below capacity the stated cadence IS the real one; deriving an interval
    // here would invent a problem and train users to ignore the warning.
    const health = summarizePatrolQueue({
      activeWatches: 5,
      dueNow: 3,
      dailyCapacity: 8,
    });
    assert.equal(health.saturated, false);
    assert.equal(health.realizedCycleDays, null);
    assert.equal(health.backlogDays, 1);
  });

  it("treats a full-but-not-over queue as still honored", () => {
    // due === capacity clears in exactly one sweep. Saturation begins strictly
    // above the line, otherwise a perfectly-served queue would warn.
    const health = summarizePatrolQueue({
      activeWatches: 8,
      dueNow: 8,
      dailyCapacity: 8,
    });
    assert.equal(health.saturated, false);
    assert.equal(health.realizedCycleDays, null);
  });

  it("derives the real visit interval once saturated", () => {
    // 40 watches, 8 slots a day: any one watch waits behind the other 39, so
    // it is reached every 5 days no matter what its cadence column says.
    const health = summarizePatrolQueue({
      activeWatches: 40,
      dueNow: 30,
      dailyCapacity: 8,
    });
    assert.equal(health.saturated, true);
    assert.equal(health.realizedCycleDays, 5);
    assert.equal(health.backlogDays, 4);
  });

  it("rounds partial days up", () => {
    const health = summarizePatrolQueue({
      activeWatches: 41,
      dueNow: 25,
      dailyCapacity: 8,
    });
    assert.equal(health.realizedCycleDays, 6);
    assert.equal(health.backlogDays, 4);
  });

  it("reports zero capacity as total saturation, not a crash", () => {
    // A disabled cron or a bad env override. Dividing by zero would throw in
    // the one situation the caller most needs an answer.
    const health = summarizePatrolQueue({
      activeWatches: 12,
      dueNow: 12,
      dailyCapacity: 0,
    });
    assert.equal(health.saturated, true);
    assert.equal(health.realizedCycleDays, Number.POSITIVE_INFINITY);
    assert.equal(health.backlogDays, Number.POSITIVE_INFINITY);
  });

  it("does not claim saturation when there is nothing to patrol", () => {
    const health = summarizePatrolQueue({
      activeWatches: 0,
      dueNow: 0,
      dailyCapacity: 0,
    });
    assert.equal(health.saturated, false);
    assert.equal(health.realizedCycleDays, null);
  });

  it("clamps negative and fractional inputs instead of trusting them", () => {
    const health = summarizePatrolQueue({
      activeWatches: -3,
      dueNow: -1,
      dailyCapacity: 8.9,
    });
    assert.equal(health.activeWatches, 0);
    assert.equal(health.dueNow, 0);
    assert.equal(health.dailyCapacity, 8);
  });
});

describe("realizedIntervalDays", () => {
  it("never promises faster than the cadence asked for", () => {
    // A queue with room to spare does not visit early — weekly stays weekly.
    assert.equal(realizedIntervalDays("weekly", null), 7);
    assert.equal(realizedIntervalDays("weekly", 3), 7);
    assert.equal(realizedIntervalDays("every_3_days", null), 3);
    assert.equal(realizedIntervalDays("daily", null), 1);
  });

  it("reports the queue interval when it is the binding constraint", () => {
    assert.equal(realizedIntervalDays("daily", 5), 5);
    assert.equal(realizedIntervalDays("weekly", 30), 30);
  });
});

describe("isCadenceHonored", () => {
  it("is true whenever the queue is not the binding constraint", () => {
    assert.equal(isCadenceHonored("daily", null), true);
    assert.equal(isCadenceHonored("daily", 1), true);
    assert.equal(isCadenceHonored("weekly", 5), true);
  });

  it("is false exactly when the promise cannot be kept", () => {
    assert.equal(isCadenceHonored("daily", 2), false);
    assert.equal(isCadenceHonored("weekly", 8), false);
    assert.equal(isCadenceHonored("daily", Number.POSITIVE_INFINITY), false);
  });
});
