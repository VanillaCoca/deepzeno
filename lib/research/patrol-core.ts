// Pure helpers — no server-only import so node:test can import this directly.
//
// Watchtower patrol logic (spec 2026-06-10-watchtower-l3-design.md, sentinel
// tier): decide when a watch is due, whether re-collected material amounts to
// a signal, and whether a signal may become an alert (alerts are scarce —
// constitution §2a: patrol frequency and alert frequency are decoupled).

import type { IRKind } from "@/lib/ir/types";
import type { PatrolCadence } from "./agent-settings";
import { verifyQuote } from "./text";

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export type PatrolBudget = {
  maxSearches: number;
  maxFetches: number;
  alertCooldownDays: number;
  weeklyAlertCap: number;
  maxWatchesPerSweep: number;
  /**
   * How many patrols one sweep asks to run at a time.
   *
   * A patrol is almost entirely waiting — two searches, three page fetches,
   * a handful of model calls — so running them one after another spent a
   * 300-second invocation mostly idle and capped the whole product's standing
   * capacity at 8 watches a day. Raising it costs nothing per patrol; it only
   * changes how much of the invocation is used.
   *
   * "Asks to" is doing real work in that sentence. Four lanes in production
   * still deliver 8 patrols a sweep, arriving evenly spaced rather than in
   * bursts, which is what serialisation somewhere below this setting looks
   * like — probably the model provider serving one request per deployment at a
   * time. So this is a ceiling this code requests, not a throughput it
   * achieves. Never derive capacity from it; see sweep-capacity-core, which
   * measures instead.
   *
   * Not unbounded, for the ordinary reason: every lane holds open sockets to
   * the same few search and model endpoints, and enough of them turns one
   * deployment into a rate-limit problem for every tenant at once.
   */
  sweepConcurrency: number;
  // How many times a day the sweep actually fires. Not a limit like the rest
  // of this object — a fact about the deployment, and the one that turns a
  // per-sweep cap into a throughput. Vercel Hobby allows one daily cron, and
  // vercel.json declares exactly one, so 1. It lives here because
  // maxWatchesPerSweep is meaningless on its own: 24 per sweep is 24 a day or
  // 288 a day depending entirely on this number, and nothing in the system
  // could state which until now.
  sweepsPerDay: number;
};

function intFromEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number
) {
  const parsed = Number.parseInt(env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Sentinel patrols are deliberately much tighter than L2 research runs.
export function resolvePatrolBudget(
  env: Record<string, string | undefined> = process.env
): PatrolBudget {
  return {
    maxSearches: intFromEnv(env, "ZENO_PATROL_MAX_SEARCHES", 2),
    maxFetches: intFromEnv(env, "ZENO_PATROL_MAX_FETCHES", 3),
    alertCooldownDays: intFromEnv(env, "ZENO_PATROL_ALERT_COOLDOWN_DAYS", 7),
    weeklyAlertCap: intFromEnv(env, "ZENO_PATROL_WEEKLY_ALERT_CAP", 3),
    // 24, not 8. The old number was not a budget decision — it was what a
    // serial loop could finish inside 300 seconds. This one is a budget
    // decision, and it is an upper bound on how much work the sweep may take
    // on, not a claim about how much it gets through: production finishes 8 of
    // these 24 and defers the rest. Keeping the cap above the real ceiling is
    // deliberate — it is the over-fetch that lets a sweep discover the ceiling
    // at all (see the note at the listDueWatches call site).
    maxWatchesPerSweep: intFromEnv(
      env,
      "ZENO_PATROL_MAX_WATCHES_PER_SWEEP",
      24
    ),
    sweepConcurrency: intFromEnv(env, "ZENO_PATROL_SWEEP_CONCURRENCY", 4),
    sweepsPerDay: intFromEnv(env, "ZENO_PATROL_SWEEPS_PER_DAY", 1),
  };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 3600 * 1000;

// Exported because a cadence is a promise, and patrol-queue-core has to be
// able to weigh it against what the queue can actually deliver.
export const CADENCE_DAYS: Record<PatrolCadence, number> = {
  daily: 1,
  every_3_days: 3,
  weekly: 7,
};

/**
 * Backoff for watches that keep finding nothing.
 *
 * The queue is a fixed number of patrols a day shared by every watch in the
 * deployment, and `watch-suggest.ts` adds one for every evidence-backed node
 * while nothing ever removes one. Supply is constant, demand is monotonic:
 * that is why "daily" silently became "monthly", and raising concurrency only
 * moved the crossing point.
 *
 * FIFO is the part worth attacking. A saturated queue spends its slots
 * uniformly, so the watch on a claim that has not moved in three months
 * displaces the watch on a claim that changes weekly — every day, forever.
 * The scarce resource is not money, it is attention, and attention should go
 * where the yield is. A run of quiet patrols is the only evidence the system
 * has about yield, so it is what the interval is derived from.
 *
 * `step` — patrols per doubling. 1 would let a single quiet day halve a daily
 * watch's rate, which is noise, not evidence; 3 makes each doubling cost a
 * repeated observation.
 *
 * `maxDays` — the interval never exceeds this, however long the silence. A
 * watch is never retired and never disabled: sum the visits over a year and
 * backoff turns 365 patrols into roughly a dozen, which bounds the standing
 * cost that Layer 2 of the cost model exists to bound, while still promising
 * that something checks. Retiring quiet watches would bound it too, and would
 * be a silent forfeiture of coverage — precisely what Iron Law 2 forbids.
 */
export const QUIET_BACKOFF = {
  step: 3,
  maxDays: 30,
} as const;

/**
 * How long this watch has actually earned until its next visit, in days.
 *
 * Never shorter than the cadence: backoff only ever slows a watch down. A
 * caller may pass a count from a pre-migration row (undefined → 0), which is
 * the old behaviour exactly.
 */
export function patrolIntervalDays(
  cadence: PatrolCadence,
  quietPatrols = 0
): number {
  const base = CADENCE_DAYS[cadence];
  const quiet = Number.isFinite(quietPatrols) ? Math.max(0, quietPatrols) : 0;
  const doublings = Math.floor(quiet / QUIET_BACKOFF.step);
  // Cap the exponent before the shift, not after: 2 ** 1024 is Infinity, and
  // a watch that has been quiet for years must not produce NaN here.
  const factor = 2 ** Math.min(doublings, 20);
  return Math.min(base * factor, QUIET_BACKOFF.maxDays);
}

export function computeNextDueAt(
  cadence: PatrolCadence,
  from: Date,
  quietPatrols = 0
): Date {
  return new Date(
    from.getTime() + patrolIntervalDays(cadence, quietPatrols) * DAY_MS
  );
}

/** True when this watch's own history, not the queue, has slowed it down. */
export function isBackedOff(cadence: PatrolCadence, quietPatrols = 0): boolean {
  return patrolIntervalDays(cadence, quietPatrols) > CADENCE_DAYS[cadence];
}

export type PatrolOutcome = "quiet" | "signal" | "failed";

/**
 * The counter's whole transition table, in one place so it can be tested
 * without a database.
 *
 * `failed` returning the count unchanged is the load-bearing case. A patrol
 * throws because a key died, a search provider 500'd, or a page timed out —
 * none of which is evidence that the watched claim is stable. Counting those
 * as quiet would let a broken provider back every watch in the system off to
 * monthly, and the symptom would appear weeks later as "Zeno stopped
 * noticing things", with nothing in the record connecting the two.
 */
export function nextQuietPatrols(
  current: number,
  outcome: PatrolOutcome
): number {
  const count = Number.isFinite(current) ? Math.max(0, current) : 0;
  if (outcome === "signal") {
    return 0;
  }
  if (outcome === "quiet") {
    return count + 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

export type PatrolEvidenceInput = {
  quote: string;
  claim: string;
  stance: "supports" | "contradicts" | "neutral";
};

export type PriorEvidenceInput = {
  quote: string;
  url: string;
};

export type RefetchedPageInput = {
  url: string;
  text: string;
};

export type PatrolSignal = {
  signal: boolean;
  kind: "new_contradiction" | "quote_vanished" | null;
  detail: string | null;
};

function normalizeQuote(quote: string) {
  return quote.replace(/\s+/g, " ").trim().toLowerCase();
}

// A patrol produces a signal when (a) freshly extracted evidence CONTRADICTS
// the watched node and is not something we already knew, or (b) a previously
// verified verbatim quote no longer appears on its (refetched) source page —
// the original grounding has moved.
export function evaluatePatrolSignal({
  newItems,
  priorEvidence,
  refetchedPages,
}: {
  newItems: PatrolEvidenceInput[];
  priorEvidence: PriorEvidenceInput[];
  refetchedPages: RefetchedPageInput[];
}): PatrolSignal {
  const knownQuotes = new Set(
    priorEvidence.map((item) => normalizeQuote(item.quote))
  );

  const freshContradiction = newItems.find(
    (item) =>
      item.stance === "contradicts" &&
      !knownQuotes.has(normalizeQuote(item.quote))
  );
  if (freshContradiction) {
    return {
      signal: true,
      kind: "new_contradiction",
      detail: freshContradiction.claim,
    };
  }

  const pageByUrl = new Map(
    refetchedPages.map((page) => [page.url, page.text])
  );
  const vanished = priorEvidence.find((item) => {
    const pageText = pageByUrl.get(item.url);
    return pageText !== undefined && !verifyQuote(item.quote, pageText);
  });
  if (vanished) {
    return {
      signal: true,
      kind: "quote_vanished",
      detail: vanished.url,
    };
  }

  return { signal: false, kind: null, detail: null };
}

// ---------------------------------------------------------------------------
// Alert scarcity
// ---------------------------------------------------------------------------

export function shouldAlert({
  lastAlertAt,
  cooldownDays,
  weeklyAlertCount,
  weeklyCap,
  now,
}: {
  lastAlertAt: string | null;
  cooldownDays: number;
  weeklyAlertCount: number;
  weeklyCap: number;
  now: Date;
}): boolean {
  if (weeklyAlertCount >= weeklyCap) {
    return false;
  }
  if (!lastAlertAt) {
    return true;
  }
  return (
    now.getTime() - new Date(lastAlertAt).getTime() >= cooldownDays * DAY_MS
  );
}

// ---------------------------------------------------------------------------
// Auto-suggestion (which nodes deserve a Zeno-initiated watch)
// ---------------------------------------------------------------------------

// Watch-worthiness follows the node's grounding, with kind as a prior (spec):
// hypotheses exist to be falsified; goals/principles/plans are never
// auto-watched (agenda belongs to the user / covered transitively); anything
// else earns a freshness patrol once it carries web evidence.
export function isWatchWorthy({
  kind,
  hasEvidence,
  dependentCount,
}: {
  kind: IRKind;
  hasEvidence: boolean;
  dependentCount: number;
}): boolean {
  if (kind === "goal" || kind === "principle" || kind === "plan") {
    return false;
  }
  if (kind === "hypothesis") {
    return hasEvidence || dependentCount > 0;
  }
  return hasEvidence;
}
