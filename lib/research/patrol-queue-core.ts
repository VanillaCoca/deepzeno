// Pure helpers — no server-only import so node:test can import this directly.
//
// The patrol queue as a finite resource.
//
// Every other part of Watchtower reasons about one watch at a time: this node,
// this cadence, this next_due_at. But all watches are served by a single daily
// cron with a fixed per-sweep cap, so the queue has a throughput, and a cadence
// is a promise made against it. Nothing in the system ever compared the two.
// That is how a watch can say "daily" and be visited once a month: the number
// of watches grew (watch-suggest.ts creates one for every evidence-backed node
// and nothing ever retires it) while throughput stayed at maxWatchesPerSweep ×
// sweepsPerDay.
//
// Iron Law 2 permits the miss — patrolling less than promised is losing
// coverage, not inventing truth. It does not permit the silence. This module
// exists so the gap is computable, and therefore sayable.

import type { PatrolCadence } from "./agent-settings";
import { CADENCE_DAYS } from "./patrol-core";

export type PatrolQueueHealth = {
  activeWatches: number;
  dueNow: number;
  /** Patrols the deployment can actually perform in 24h. */
  dailyCapacity: number;
  /**
   * More already-late work than a full day of capacity. This is the line where
   * cadences stop meaning anything: below it every watch is served on time and
   * `next_due_at` is the schedule; above it `next_due_at` is only a queue
   * position.
   */
  saturated: boolean;
  /** Days of full-capacity work to clear what is *already* overdue. */
  backlogDays: number;
  /**
   * Mean days between visits to any one watch, once saturated. A fully-booked
   * FIFO queue spends every slot, so throughput is the capacity and a watch
   * waits behind all the others: activeWatches / dailyCapacity.
   *
   * Null when not saturated — there the stated cadence is the real one, and
   * reporting a derived interval would invent a problem that does not exist.
   */
  realizedCycleDays: number | null;
};

export function summarizePatrolQueue({
  activeWatches,
  dueNow,
  dailyCapacity,
}: {
  activeWatches: number;
  dueNow: number;
  dailyCapacity: number;
}): PatrolQueueHealth {
  // Capacity zero is a real deployment state (the cron disabled, or a bad env
  // override). Report it as total saturation rather than dividing by zero:
  // nothing is being patrolled, and that is the most important thing to say.
  const capacity = Math.max(0, Math.floor(dailyCapacity));
  const active = Math.max(0, activeWatches);
  const due = Math.max(0, dueNow);

  if (capacity === 0) {
    return {
      activeWatches: active,
      dueNow: due,
      dailyCapacity: 0,
      saturated: active > 0,
      backlogDays: Number.POSITIVE_INFINITY,
      realizedCycleDays: active > 0 ? Number.POSITIVE_INFINITY : null,
    };
  }

  const saturated = due > capacity;
  return {
    activeWatches: active,
    dueNow: due,
    dailyCapacity: capacity,
    saturated,
    backlogDays: Math.ceil(due / capacity),
    realizedCycleDays: saturated ? Math.ceil(active / capacity) : null,
  };
}

/**
 * What a stated cadence actually buys, in days.
 *
 * Never faster than the cadence (a queue with room to spare does not visit
 * early) and never faster than the queue allows. This is the number a user
 * should see next to the cadence they picked.
 *
 * Takes the cycle length rather than the whole health object so the client can
 * call it: the rest of PatrolQueueHealth is a census of every project's watches
 * and has no business crossing the API boundary.
 */
export function realizedIntervalDays(
  cadence: PatrolCadence,
  realizedCycleDays: number | null
): number {
  return Math.max(CADENCE_DAYS[cadence], realizedCycleDays ?? 0);
}

/** True when the queue can still keep the promise the cadence makes. */
export function isCadenceHonored(
  cadence: PatrolCadence,
  realizedCycleDays: number | null
): boolean {
  return (
    realizedIntervalDays(cadence, realizedCycleDays) <= CADENCE_DAYS[cadence]
  );
}
