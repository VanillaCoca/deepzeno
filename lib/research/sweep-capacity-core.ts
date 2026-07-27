// Pure helpers — no server-only import so node:test can import this directly.
//
// What this deployment can actually patrol in a day.
//
// `maxWatchesPerSweep × sweepsPerDay` is a statement of intent. Throughput is a
// fact about the world, set by things no constant can see: model latency, how
// many requests the provider will serve one deployment at once, how much of the
// invocation the slow tail eats. Confusing the two is not a rounding error —
// every number derived from capacity inherits it, and inherits it in the
// reassuring direction. That is the direction Iron Law 2 does not forgive: a
// watch that promises "daily" and is reached monthly is a miss the product is
// actively hiding from the person who chose the cadence.
//
// This deployment is the worked example. The budget says 24 a day. Seven
// consecutive days delivered exactly 8, 8, 8, 8, 8, 7, 8. Nothing noticed,
// because the sweep prints `processed` to a log line and then throws it away —
// so the queue summary kept reporting a cycle three times faster than the one
// users were actually getting.
//
// The fix is not a better constant. A constant is the same category error, and
// it would be wrong again the moment the bottleneck moves. The sweep already
// computes the right number every time it runs; this module is what happens
// when that number is kept.

/**
 * Event name the sweep writes and the estimator reads.
 *
 * A shared constant rather than two string literals: the writer and the reader
 * drifting apart would not fail, it would silently produce zero observations
 * and fall back to the configured number forever — which is indistinguishable
 * from the bug this module was written to fix.
 */
export const SWEEP_EVENT = "watchtower_sweep";

/** One sweep's own account of itself. */
export type SweepObservation = {
  /** Patrols the sweep actually finished. */
  processed: number;
  /** Due watches it ran out of clock before starting. */
  deferred: number;
};

export type CapacityEstimate = {
  /** Patrols one sweep can be expected to finish. */
  perSweep: number;
  /** The throughput every cadence promise is denominated in. */
  perDay: number;
  /** Whether this came from the record or from the config it falls back to. */
  source: "observed" | "configured";
  /** Capacity-bound sweeps behind `perSweep`. Zero whenever configured. */
  samples: number;
};

/**
 * Sweeps considered. Two weeks at one sweep a day: long enough that a single
 * bad night cannot move the estimate, short enough that a real bottleneck
 * surfaces within a fortnight rather than being averaged away forever.
 */
export const CAPACITY_WINDOW = 14;

/** Below this, one lucky sweep would be allowed to set the number. */
export const MIN_CAPACITY_SAMPLES = 3;

/**
 * Middle value, rounding an even split down.
 *
 * Median, not mean, because both tails of this distribution are real and
 * neither is informative. A manual backfill put 191 patrols on one day; a
 * provider outage will one day put 0 on another. A mean would let either
 * rewrite the answer. The median is what a normal day delivers, which is the
 * only thing a cadence can be promised against.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Capacity from the record, falling back to the budget when the record cannot
 * answer.
 *
 * `observations` must be newest-first; only the most recent `CAPACITY_WINDOW`
 * are considered.
 *
 * The load-bearing filter is `deferred > 0`. `processed` is censored from
 * above: a sweep that finished everything it was handed tells you what it was
 * handed, not what it could have done. Only a sweep that still had work when
 * the clock ran out has measured its own ceiling. Averaging over quiet days
 * instead would report a capacity that falls as the queue empties — the number
 * would be lowest exactly when the system was healthiest.
 *
 * A sweep that crashed outright writes no observation at all, so it shows up
 * here as a missing day rather than as a capacity of zero. That is deliberate:
 * a crash is evidence about the product, not about how much the product can do.
 */
export function estimateSweepCapacity({
  observations,
  configuredPerSweep,
  sweepsPerDay,
}: {
  observations: SweepObservation[];
  configuredPerSweep: number;
  sweepsPerDay: number;
}): CapacityEstimate {
  const perDayFrom = (perSweep: number) =>
    Math.max(0, Math.floor(perSweep) * Math.max(0, Math.floor(sweepsPerDay)));
  const configured = Math.max(0, Math.floor(configuredPerSweep));
  const fallback: CapacityEstimate = {
    perSweep: configured,
    perDay: perDayFrom(configured),
    source: "configured",
    samples: 0,
  };

  const bound = observations
    .slice(0, CAPACITY_WINDOW)
    .filter(
      (o) =>
        Number.isFinite(o.processed) &&
        Number.isFinite(o.deferred) &&
        o.deferred > 0
    )
    .map((o) => Math.max(0, Math.trunc(o.processed)));

  if (bound.length === 0) {
    return fallback;
  }

  const perSweep = median(bound);
  const observed: CapacityEstimate = {
    perSweep,
    perDay: perDayFrom(perSweep),
    source: "observed",
    samples: bound.length,
  };

  if (bound.length >= MIN_CAPACITY_SAMPLES) {
    return observed;
  }

  // One or two samples are not enough to raise the estimate, but they are
  // enough to lower it. The asymmetry is Iron Law 2 spelled out: overstating
  // capacity produces a silent miss, understating it produces a visible warning
  // that the next few sweeps will correct. Only one of those is recoverable.
  return perSweep < configured ? observed : fallback;
}
