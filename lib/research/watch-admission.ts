import "server-only";

// One answer to "may this user start another watch", shared by both creation
// paths.
//
// It lives in its own module rather than inside either caller because the two
// callers are asymmetric in every way except this decision: `POST
// /api/watchtower` is a human pressing a button and gets an error they read,
// while `suggestWatchForNode` runs inside a research pipeline with nobody
// present. If each computed its own admission they would drift, and the drift
// would show up as Zeno quietly creating watches a user was just told they
// could not have.

import {
  type PlanLimits,
  type WatchAdmission,
  decideWatchAdmission,
  resolvePlanLimits,
} from "@/lib/billing/plan-core";
import { userFundsOwnModels } from "@/lib/billing/funding";
import { countActiveWatchesForUser } from "./watch-queries";

export type { WatchAdmission } from "@/lib/billing/plan-core";

/**
 * Errors propagate. A quota check that swallows its own failure and returns
 * "admitted" is worse than no quota at all: it produces exactly the unbounded
 * standing cost the quota exists to stop, on precisely the days the database
 * is unhealthy.
 */
export async function admitNewWatch(
  userId: string,
  limits: PlanLimits = resolvePlanLimits()
): Promise<WatchAdmission> {
  const [hasOwnKey, activeWatches] = await Promise.all([
    userFundsOwnModels(userId),
    countActiveWatchesForUser(userId),
  ]);

  return decideWatchAdmission({ hasOwnKey, activeWatches, limits });
}

/**
 * The sentence shown to a user who has hit the cap.
 *
 * Built here, not in the error table, because the numbers are the whole
 * message — "you have reached the limit" without them is a dead end, and the
 * limit is configurable per deployment so it cannot be a constant in a string
 * table that also ships to the browser.
 */
export function watchQuotaMessage(
  admission: WatchAdmission,
  limits: PlanLimits = resolvePlanLimits()
): string {
  const base = `${admission.activeWatches}/${admission.quota} watches are active.`;
  return admission.quota < limits.byokMaxActiveWatches
    ? `${base} Pause one, or connect your own API key in Settings to raise the limit to ${limits.byokMaxActiveWatches}.`
    : `${base} Pause one to start another.`;
}
