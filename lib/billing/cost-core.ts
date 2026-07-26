// Pure cost metering — no server-only import, so node:test and client
// components can both read this.
//
// There are TWO cost questions in this system and they want opposite answers
// when the price is unknown:
//
//   "What did this run cost?"        — reporting. Must never lie. If nothing
//                                      priced was used, the honest answer is
//                                      "unknown", i.e. null.
//   "How much of your free allowance — rationing. Must never return null,
//    did this consume?"                because null is indistinguishable from
//                                      free, and a free-forever path is how an
//                                      allowance stops bounding anything.
//
// `computeCostEstimate` answers the first. `meterCostUsd` answers the second.
// They deliberately disagree, and the disagreement is the point: an unpriced
// frontier model reports `null` on the run detail and still draws down the
// allowance at a conservative upper bound.
//
// The precedent is already in models.ts, on `deepseek:default`: "A stale price
// is a wrong estimate; no price is a run that claims to be free." That comment
// was written about reporting. Rationing needs the stronger version.

import { findModelById, type ModelTier } from "@/lib/ai/models";

export type TokenUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
};

/**
 * Model id (or a pseudo-key like `search:tavily`) → tokens spent under it.
 * The keys that are not real model ids carry no token price and are skipped by
 * both functions below — search fees are not token-denominated.
 */
export type ModelsUsedAccumulator = Record<
  string,
  { inputTokens: number; outputTokens: number }
>;

export function addUsage(
  acc: ModelsUsedAccumulator,
  key: string,
  usage: TokenUsage
) {
  const existing = acc[key] ?? { inputTokens: 0, outputTokens: 0 };
  acc[key] = {
    inputTokens: existing.inputTokens + (usage.inputTokens ?? 0),
    outputTokens: existing.outputTokens + (usage.outputTokens ?? 0),
  };
}

/**
 * Deliberately-high stand-in prices, USD per 1M tokens, used ONLY for
 * rationing when a model carries no price of its own.
 *
 * These are Anthropic's published Sonnet (3/15) and Opus (15/75) rates. Two
 * reasons they are the right stand-ins: they are real prices for real models
 * at those tiers, so they are defensible rather than invented; and they sit at
 * or above what the unpriced entries actually cost, so the error direction is
 * "the free tier is slightly smaller than it had to be" — never "a stranger
 * burned credits that were never counted".
 *
 * Over-estimating is the safe direction. Under-estimating is unbounded.
 */
const FALLBACK_PRICE_PER_MTOK: Record<
  ModelTier,
  { input: number; output: number }
> = {
  economy: { input: 1, output: 3 },
  standard: { input: 3, output: 15 },
  frontier: { input: 15, output: 75 },
};

function priceOf(modelId: string): {
  input: number;
  output: number;
  known: boolean;
} | null {
  const definition = findModelById(modelId);
  if (!definition) {
    // Not a model key at all (e.g. "search:anthropic"). Not unpriced — not a
    // token spend in the first place.
    return null;
  }
  const { inputCostPerMTok, outputCostPerMTok, tier } = definition;
  if (inputCostPerMTok !== null && outputCostPerMTok !== null) {
    return { input: inputCostPerMTok, output: outputCostPerMTok, known: true };
  }
  const fallback = FALLBACK_PRICE_PER_MTOK[tier];
  return { input: fallback.input, output: fallback.output, known: false };
}

function costFor(
  usage: { inputTokens: number; outputTokens: number },
  price: { input: number; output: number }
): number {
  return (
    (usage.inputTokens * price.input) / 1_000_000 +
    (usage.outputTokens * price.output) / 1_000_000
  );
}

/**
 * What to show the user this run cost.
 *
 * Null when nothing with a known price was used — the run's cost is genuinely
 * unknown and saying "$0.00" would be a lie the UI then repeats forever.
 * Gateway/Perplexity serving fees are not token-priced, so this undercounts
 * that path; the `search:*` keys are skipped rather than guessed at.
 */
export function computeCostEstimate(
  modelsUsed: ModelsUsedAccumulator
): number | null {
  let total = 0;
  let knownCount = 0;

  for (const [key, usage] of Object.entries(modelsUsed)) {
    const price = priceOf(key);
    if (!price?.known) {
      continue;
    }
    total += costFor(usage, price);
    knownCount++;
  }

  return knownCount > 0 ? total : null;
}

export type MeteredCost = {
  /** Always a number. Never null. This is what the allowance is charged. */
  usd: number;
  /** Model keys billed at their real published price. */
  pricedKeys: string[];
  /**
   * Model keys billed at the tier fallback. Non-empty means `usd` is an upper
   * bound rather than an estimate — worth surfacing to an operator tuning the
   * allowance, and worth never surfacing to a user as "your cost".
   */
  estimatedKeys: string[];
};

/**
 * What to charge against the free allowance.
 *
 * Every token spend contributes something. A model with no price contributes
 * its tier's stand-in rate, because the alternative — contributing zero — makes
 * the whole allowance unenforceable through the one path most likely to be
 * expensive (the unpriced entries are the frontier models).
 */
export function meterCostUsd(modelsUsed: ModelsUsedAccumulator): MeteredCost {
  let usd = 0;
  const pricedKeys: string[] = [];
  const estimatedKeys: string[] = [];

  for (const [key, usage] of Object.entries(modelsUsed)) {
    const price = priceOf(key);
    if (!price) {
      continue;
    }
    usd += costFor(usage, price);
    if (price.known) {
      pricedKeys.push(key);
    } else {
      estimatedKeys.push(key);
    }
  }

  return { usd, pricedKeys, estimatedKeys };
}
