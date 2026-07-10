// Runtime resilience for model routing: a per-provider circuit breaker plus
// the retry-model chooser used by resilient generation (resilient-generate.ts).
//
// "Provider" here means the serving endpoint — the prefix of the model id
// ("deepseek:default" → "deepseek", "bedrock:claude-sonnet-4-6" → "bedrock").
// Outages are endpoint-shaped, not vendor-shaped: Anthropic-direct being down
// says nothing about Claude-via-Bedrock.
//
// State is in-memory per process. On serverless that means per warm instance,
// which is the useful scope: the breaker exists to stop a burning instance
// from hammering a failing endpoint on every request in quick succession.

import { getActiveModels, type ModelTier } from "@/lib/ai/models";

export function providerKeyForModel(modelId: string): string {
  const separator = modelId.indexOf(":");
  return separator === -1 ? modelId : modelId.slice(0, separator);
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

type BreakerState = {
  consecutiveFailures: number;
  openedAt: number | null;
};

export class ProviderCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly states = new Map<string, BreakerState>();

  constructor(options?: {
    failureThreshold?: number;
    cooldownMs?: number;
    now?: () => number;
  }) {
    this.failureThreshold =
      options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = options?.now ?? Date.now;
  }

  private state(provider: string): BreakerState {
    let state = this.states.get(provider);
    if (!state) {
      state = { consecutiveFailures: 0, openedAt: null };
      this.states.set(provider, state);
    }
    return state;
  }

  recordFailure(provider: string): void {
    const state = this.state(provider);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.openedAt = this.now();
    }
  }

  recordSuccess(provider: string): void {
    this.states.set(provider, { consecutiveFailures: 0, openedAt: null });
  }

  // Open while cooling down. After the cooldown elapses the breaker reports
  // closed (half-open): one probe call goes through, and because the failure
  // count is still at threshold, a failed probe re-opens it immediately.
  isOpen(provider: string): boolean {
    const state = this.states.get(provider);
    if (!state || state.openedAt === null) {
      return false;
    }
    return this.now() - state.openedAt < this.cooldownMs;
  }
}

// Process-wide breaker shared by routing (model-policy) and resilient
// generation. Tests construct their own instances.
export const providerBreaker = new ProviderCircuitBreaker();

// Pick the model to retry on after `failedModelId` errored: nearest active
// model to the task's tier that is not the failed model, preferring a
// different provider. Null when the failed model was the only option.
export function chooseRetryModel(
  failedModelId: string,
  tier: ModelTier,
  env: Record<string, string | undefined> = process.env
): string | null {
  const failedProvider = providerKeyForModel(failedModelId);
  const candidates = getActiveModels(env).filter(
    (model) => model.id !== failedModelId
  );

  if (candidates.length === 0) {
    return null;
  }

  const tierRank: Record<ModelTier, number> = {
    economy: 0,
    standard: 1,
    frontier: 2,
  };
  const target = tierRank[tier];

  const [best] = [...candidates].sort((a, b) => {
    // Different provider beats same provider (the endpoint just failed).
    const aSameProvider = providerKeyForModel(a.id) === failedProvider ? 1 : 0;
    const bSameProvider = providerKeyForModel(b.id) === failedProvider ? 1 : 0;
    if (aSameProvider !== bSameProvider) {
      return aSameProvider - bSameProvider;
    }
    // Then closeness to the desired tier, cheaper on ties.
    const aDistance = Math.abs(tierRank[a.tier] - target);
    const bDistance = Math.abs(tierRank[b.tier] - target);
    if (aDistance !== bDistance) {
      return aDistance - bDistance;
    }
    return tierRank[a.tier] - tierRank[b.tier];
  });

  return best.id;
}
