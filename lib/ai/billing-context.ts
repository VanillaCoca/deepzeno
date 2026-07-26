import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { ByokProviderId } from "./byok-routing";

// Request-scoped answer to "whose money is this call spending".
//
// Why AsyncLocalStorage rather than threading a parameter: `getLanguageModel`
// has eleven call sites, and the functions that reach them (research pipeline,
// patrol, sweep, compaction) are three or four frames deep. Threading a
// credentials bag through all of that would put a `keys` parameter on every
// intermediate signature — functions that have no business knowing about
// billing would have to carry it, and every new call site would be one more
// place to forget it. Funding is genuinely ambient per-request state, which is
// what ALS is for.
//
// The risk ALS brings is silent context loss: if the store is empty at call
// time, a BYOK user's call quietly runs on the platform key and the operator
// pays a bill they were told they would not. That is the exact failure this
// whole cost model exists to prevent, so `assertBillingContext` exists to make
// a broken propagation path fail on the first request instead of on the
// invoice.

export type BillingFunding = "platform" | "byok";

export type BillingContext = {
  userId: string;
  /**
   * Decrypted keys for this user, by provider. Present only for providers the
   * user actually connected; absent means "this call falls back to the
   * platform allowance", which is a legitimate mixed state — a user may fund
   * their own DeepSeek and still use the platform's Anthropic.
   */
  keys: Partial<Record<ByokProviderId, string>>;
};

const storage = new AsyncLocalStorage<BillingContext>();

export function runWithBillingContext<T>(
  context: BillingContext,
  fn: () => T
): T {
  return storage.run(context, fn);
}

export function getBillingContext(): BillingContext | null {
  return storage.getStore() ?? null;
}

/** The user's own key for a model, or null to use the platform's. */
export function byokKeyForProvider(
  provider: ByokProviderId | null
): string | null {
  if (!provider) {
    return null;
  }
  return storage.getStore()?.keys[provider] ?? null;
}

/**
 * Tripwire, called immediately inside `runWithBillingContext`.
 *
 * If ALS ever stops propagating in this runtime, this throws on the first
 * request in dev and CI rather than producing a month of misattributed spend
 * that nothing in the system can detect after the fact.
 */
export function assertBillingContext(expectedUserId: string): void {
  const context = storage.getStore();
  if (!context || context.userId !== expectedUserId) {
    throw new Error(
      "Billing context did not propagate. Refusing to run an AI call whose funding source is unknown."
    );
  }
}
