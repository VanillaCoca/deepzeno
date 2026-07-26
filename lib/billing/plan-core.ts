// Pure plan/quota logic — no server-only import, so node:test and client
// components can both read this.
//
// This module answers exactly two runtime questions:
//
//   1. Who pays for this AI call?          → decideFunding
//   2. May this user start another watch?  → decideWatchAdmission
//
// They are separate because the costs they govern are separate. A chat message
// or a research run is a ONE-SHOT cost: it happens because a human pressed
// something, so its total is bounded by human attention, and a dollar
// allowance is the right instrument. A watch is a STANDING cost: one press
// bills every day forever, and `suggestWatchForNode` creates them with no
// press at all.
//
// A dollar allowance does bound standing cost in the narrow sense — 40 watches
// simply drain the month's budget in three days. But *how* it stops them is
// the problem: the allowance runs out at execution time, inside a cron, with
// nobody watching. A patrol that silently stops running is precisely the
// failure Iron Law 2 forbids (may miss, may not miss silently), and it is the
// same shape as the queue-starvation bug this work exists to fix. So standing
// cost gets a second limit that is checked at CREATION time, when there is
// still a human present to be told no.
//
// That is the whole justification for having two limits instead of one: not
// two kinds of money, but two moments at which the answer can still be heard.

type EnvLike = Record<string, string | undefined>;

export type PlanLimits = {
  /**
   * Platform-funded spend per user per calendar month, USD. Charged using
   * `meterCostUsd` (the conservative one), never `computeCostEstimate`.
   */
  monthlyAllowanceUsd: number;
  /** Active watches allowed while the platform is paying. */
  maxActiveWatches: number;
  /**
   * Active watches allowed once the user has connected their own key.
   * Higher, but NOT unlimited — the earlier design note said unlimited, and
   * that was wrong. A patrol costs the operator nothing when it runs on the
   * user's key, but it still consumes one slot in a single shared daily cron.
   * Unlimited watches for one tenant is the starvation bug reintroduced
   * through the back door, just with a different victim.
   */
  byokMaxActiveWatches: number;
};

function intFromEnv(env: EnvLike, key: string, fallback: number) {
  const parsed = Number.parseInt(env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function floatFromEnv(env: EnvLike, key: string, fallback: number) {
  const parsed = Number.parseFloat(env[key] ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Defaults, and why these numbers:
 *
 * `monthlyAllowanceUsd: 2` — on the default research stack (DeepSeek at
 * $0.14/$0.28 per MTok) that is roughly a thousand chat messages or a few
 * dozen research runs: enough that a new user can evaluate the product
 * honestly, not enough that one stranger can drain a personal credit balance.
 * Anyone who wants more connects a key; that is the entire model.
 *
 * `maxActiveWatches: 5` — derived from capacity, not from dollars. One daily
 * cron with bounded concurrency serves on the order of 40 patrols a day for
 * the whole deployment. Five daily watches per user means ~8 users before the
 * queue is the binding constraint, and `summarizePatrolQueue` will say so out
 * loud when it is. Raising throughput raises this number; nothing else should.
 *
 * `byokMaxActiveWatches: 20` — half a day's capacity. A single tenant may take
 * a large share of a shared queue, never all of it.
 */
export function resolvePlanLimits(env: EnvLike = process.env): PlanLimits {
  return {
    monthlyAllowanceUsd: floatFromEnv(env, "ZENO_MONTHLY_ALLOWANCE_USD", 2),
    maxActiveWatches: intFromEnv(env, "ZENO_MAX_ACTIVE_WATCHES", 5),
    byokMaxActiveWatches: intFromEnv(env, "ZENO_BYOK_MAX_ACTIVE_WATCHES", 20),
  };
}

// ---------------------------------------------------------------------------
// Billing period
// ---------------------------------------------------------------------------

/**
 * `YYYY-MM` in UTC. The ledger sums a user's spend within one of these.
 *
 * UTC rather than local time because the alternative is a per-user reset
 * instant that no server-side query can express, and a monthly boundary is
 * already arbitrary. Stated plainly in the UI, an arbitrary-but-fixed reset is
 * fine; a reset nobody can compute twice the same way is not.
 */
export function billingPeriodKey(now: Date): string {
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

/** Inclusive start / exclusive end of the period, for range queries. */
export function billingPeriodRange(now: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
  return { start, end };
}

// ---------------------------------------------------------------------------
// Who pays
// ---------------------------------------------------------------------------

export type FundingSource = "byok" | "platform" | "denied";

export type FundingDecision = {
  source: FundingSource;
  /**
   * Platform allowance left, USD, clamped at 0. Always a number — including on
   * the `byok` path, where it is simply untouched. `null` here would mean
   * "unknown", and nothing in this function is unknown.
   */
  remainingUsd: number;
  reason: "own_key" | "within_allowance" | "allowance_exhausted";
};

/**
 * Own key wins whenever there is one, even while free allowance remains.
 *
 * The tempting alternative — spend the platform's free dollars first, since
 * they were promised to everyone — loses on predictability. The only reason
 * anyone pastes a key into this product is to stop being metered; if the key
 * takes effect at some invisible later moment, "I connected my key" no longer
 * has a single meaning the user can hold in their head. It also leaves the
 * platform allowance for the users who have no other option, which is who a
 * free tier is actually for.
 */
export function decideFunding({
  hasOwnKey,
  spentUsd,
  limits,
}: {
  hasOwnKey: boolean;
  spentUsd: number;
  limits: PlanLimits;
}): FundingDecision {
  const spent = Number.isFinite(spentUsd) ? Math.max(0, spentUsd) : 0;
  const remainingUsd = Math.max(0, limits.monthlyAllowanceUsd - spent);

  if (hasOwnKey) {
    return { source: "byok", remainingUsd, reason: "own_key" };
  }
  if (remainingUsd > 0) {
    return { source: "platform", remainingUsd, reason: "within_allowance" };
  }
  return { source: "denied", remainingUsd: 0, reason: "allowance_exhausted" };
}

// ---------------------------------------------------------------------------
// Standing cost admission
// ---------------------------------------------------------------------------

export type WatchAdmission = {
  admitted: boolean;
  reason: "within_quota" | "quota_exhausted";
  /** The quota that applied, so the caller can say the number out loud. */
  quota: number;
  activeWatches: number;
};

/**
 * Checked before a watch is created, never before one runs.
 *
 * The caller is obliged to do something visible with a refusal. For a manual
 * request that means an error the user reads; for `suggestWatchForNode` it
 * means an IR event and a mark on the node, because an auto-suggestion that is
 * silently dropped is indistinguishable from a system that decided the node
 * was not worth watching — and the user would have no way to tell those apart.
 */
export function decideWatchAdmission({
  hasOwnKey,
  activeWatches,
  limits,
}: {
  hasOwnKey: boolean;
  activeWatches: number;
  limits: PlanLimits;
}): WatchAdmission {
  const quota = hasOwnKey
    ? limits.byokMaxActiveWatches
    : limits.maxActiveWatches;
  const active = Number.isFinite(activeWatches)
    ? Math.max(0, activeWatches)
    : 0;
  const admitted = active < quota;

  return {
    admitted,
    reason: admitted ? "within_quota" : "quota_exhausted",
    quota,
    activeWatches: active,
  };
}

// ---------------------------------------------------------------------------
// Splitting one run's spend between two payers
// ---------------------------------------------------------------------------

/**
 * A single research run routinely mixes funding sources: the plan step may run
 * on the user's own DeepSeek key while synthesis falls back to the platform's
 * Anthropic. Recording one `funding_source` for the whole run would either
 * charge the allowance for tokens the user paid for, or let platform tokens
 * ride in under a `byok` label and escape the allowance entirely.
 *
 * So the accumulator is split before it is written, and a run can produce two
 * ledger rows. The alternative — a per-model ledger row — is more granular
 * than any question anyone asks and multiplies inserts on the hot path.
 *
 * `hasOwnKeyFor` is passed in rather than a key map, so this stays pure and
 * the caller decides what "has a key" means (an invalid key does not count).
 */
export function partitionUsageByFunding<
  T extends Record<string, { inputTokens: number; outputTokens: number }>,
>(
  modelsUsed: T,
  hasOwnKeyFor: (modelKey: string) => boolean
): {
  platform: Record<string, { inputTokens: number; outputTokens: number }>;
  byok: Record<string, { inputTokens: number; outputTokens: number }>;
} {
  const platform: Record<
    string,
    { inputTokens: number; outputTokens: number }
  > = {};
  const byok: Record<string, { inputTokens: number; outputTokens: number }> =
    {};

  for (const [key, usage] of Object.entries(modelsUsed)) {
    if (hasOwnKeyFor(key)) {
      byok[key] = usage;
    } else {
      platform[key] = usage;
    }
  }

  return { platform, byok };
}
