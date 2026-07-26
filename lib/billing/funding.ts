import "server-only";

import {
  type BillingContext,
  assertBillingContext,
  runWithBillingContext,
} from "@/lib/ai/billing-context";
import {
  type ByokProviderId,
  MODEL_BYOK_PROVIDERS,
  byokProviderForModelId,
} from "@/lib/ai/byok-routing";
import type { ModelsUsedAccumulator } from "./cost-core";
import {
  type FundingDecision,
  type PlanLimits,
  decideFunding,
  partitionUsageByFunding,
  resolvePlanLimits,
} from "./plan-core";
import {
  BillingNotReadyError,
  type UsageKind,
  getActiveKeyProviders,
  getPlatformSpendUsd,
  getProviderApiKey,
  listProviderKeys,
  recordUsage,
} from "./queries";

/**
 * Everything needed to answer "who pays" for the rest of this request,
 * fetched once.
 *
 * Loaded per request rather than cached across requests: the cache would have
 * to hold decrypted API keys in module memory for the lifetime of a warm
 * lambda, and the thing being cached is two small indexed queries.
 */
export type UserFunding = {
  userId: string;
  keys: Partial<Record<ByokProviderId, string>>;
  /** Platform-funded spend so far this billing period, USD. */
  platformSpentUsd: number;
  limits: PlanLimits;
  /**
   * True when the billing tables are not migrated. Everything degrades to
   * platform funding with no allowance check — stated explicitly rather than
   * inferred from a zero, because "we cannot meter" and "you have spent
   * nothing" must not be the same value.
   */
  unmetered: boolean;
};

export class AllowanceExhaustedError extends Error {
  statusCode = 402;
  constructor(message: string) {
    super(message);
    this.name = "AllowanceExhaustedError";
  }
}

export async function loadUserFunding(userId: string): Promise<UserFunding> {
  const limits = resolvePlanLimits();

  try {
    const summaries = await listProviderKeys(userId);
    const keys: Partial<Record<ByokProviderId, string>> = {};

    await Promise.all(
      summaries
        .filter((summary) => summary.status === "active")
        .map(async (summary) => {
          const key = await getProviderApiKey({
            userId,
            provider: summary.provider,
          });
          if (key) {
            keys[summary.provider] = key;
          }
        })
    );

    return {
      userId,
      keys,
      platformSpentUsd: await getPlatformSpendUsd(userId),
      limits,
      unmetered: false,
    };
  } catch (error) {
    if (error instanceof BillingNotReadyError) {
      // Pre-migration deployments keep working exactly as they did before this
      // feature landed. Silently denying every user because a table is missing
      // would be a worse failure than not metering for one deploy.
      return {
        userId,
        keys: {},
        platformSpentUsd: 0,
        limits,
        unmetered: true,
      };
    }
    throw error;
  }
}

export function hasOwnKeyForModel(
  funding: UserFunding,
  modelId: string
): boolean {
  const provider = byokProviderForModelId(modelId);
  return provider ? Boolean(funding.keys[provider]) : false;
}

/** True when the user funds their own model calls at all (Tavily alone is not enough). */
export function fundsOwnModels(funding: UserFunding): boolean {
  return MODEL_BYOK_PROVIDERS.some((provider) => Boolean(funding.keys[provider]));
}

/**
 * The same question as `fundsOwnModels`, asked without loading the keys.
 *
 * `loadUserFunding` decrypts every stored key so that AI calls can use them.
 * The watch quota does not make an AI call — it only needs a boolean — and
 * decrypting six secrets to answer it would put plaintext credentials in
 * memory for a code path that has no use for them. Reads the status column
 * instead.
 *
 * Pre-migration deployments answer `false`, which lands the user on the
 * stricter quota. That is the right direction: the cap protects one shared
 * daily cron, and a missing billing table is not evidence that anyone has
 * paid for more of it.
 */
export async function userFundsOwnModels(userId: string): Promise<boolean> {
  try {
    const providers = await getActiveKeyProviders(userId);
    return MODEL_BYOK_PROVIDERS.some((provider) => providers.has(provider));
  } catch (error) {
    if (error instanceof BillingNotReadyError) {
      return false;
    }
    throw error;
  }
}

export function fundingForModel(
  funding: UserFunding,
  modelId: string
): FundingDecision {
  return decideFunding({
    hasOwnKey: hasOwnKeyForModel(funding, modelId),
    spentUsd: funding.platformSpentUsd,
    limits: funding.limits,
  });
}

/**
 * Gate a billable action before it starts.
 *
 * Checked against the model the action will actually use, because a user with
 * a DeepSeek key and an exhausted allowance can still run DeepSeek research —
 * refusing them on a global "allowance exhausted" would be charging them for
 * a resource they stopped using.
 *
 * Throws rather than degrading. Falling back to a cheaper model, a longer
 * queue, or a truncated run would all mean the user gets a worse answer and is
 * not told why, which is Iron Law 2 applied to money.
 */
export function requireFunding(funding: UserFunding, modelId: string): void {
  if (funding.unmetered) {
    return;
  }
  const decision = fundingForModel(funding, modelId);
  if (decision.source !== "denied") {
    return;
  }
  throw new AllowanceExhaustedError(
    `This month's free allowance ($${funding.limits.monthlyAllowanceUsd.toFixed(2)}) is used up. Connect your own provider key in Settings to keep going, or wait for the next billing period.`
  );
}

/**
 * Run `fn` with this user's keys installed as the ambient funding context.
 *
 * Every AI call inside — however deep — routes to the user's key when they
 * have one for that provider, and to the platform's otherwise.
 */
export function withUserFunding<T>(funding: UserFunding, fn: () => T): T {
  const context: BillingContext = {
    userId: funding.userId,
    keys: funding.keys,
  };
  return runWithBillingContext(context, () => {
    assertBillingContext(funding.userId);
    return fn();
  });
}

/**
 * Write the spend of one completed action to the ledger, split by payer.
 *
 * Takes the same `funding` the action ran under, so the split reflects the
 * keys that were actually installed — not the keys the user has right now,
 * which they may have removed mid-run.
 */
export async function settleUsage({
  funding,
  modelsUsed,
  kind,
  projectId,
  runId,
  now,
}: {
  funding: UserFunding;
  modelsUsed: ModelsUsedAccumulator;
  kind: UsageKind;
  projectId?: string | null;
  runId?: string | null;
  now?: Date;
}): Promise<void> {
  if (funding.unmetered) {
    return;
  }

  const { platform, byok } = partitionUsageByFunding(modelsUsed, (modelKey) =>
    hasOwnKeyForModel(funding, modelKey)
  );

  await Promise.all([
    recordUsage({
      userId: funding.userId,
      projectId,
      runId,
      kind,
      fundingSource: "platform",
      modelsUsed: platform,
      now,
    }),
    recordUsage({
      userId: funding.userId,
      projectId,
      runId,
      kind,
      fundingSource: "byok",
      modelsUsed: byok,
      now,
    }),
  ]);
}
