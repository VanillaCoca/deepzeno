// Per-model context-window sizes (in tokens) used to decide when a conversation
// must be compacted before it overflows the model.
//
// The per-model value is the `contextWindowTokens` field on the model registry
// (lib/ai/models.ts) — the single source of truth. This module only adds the
// fallbacks: a conservative per-provider default for env-configurable/unknown
// models, and a global floor. Values are deliberately conservative safety
// thresholds — compacting a little early is harmless; overflowing is not.

import { chatModels } from "@/lib/ai/models";

const PROVIDER_CONTEXT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  openai: 128_000,
  moonshotai: 128_000,
  deepseek: 64_000,
  alibaba: 32_000,
};

// Conservative floor for unknown models/providers.
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_000;

export function getContextWindowTokens({
  modelId,
  provider,
}: {
  modelId?: string | null;
  provider?: string | null;
}): number {
  if (modelId) {
    const model = chatModels.find((entry) => entry.id === modelId);
    if (model?.contextWindowTokens) {
      return model.contextWindowTokens;
    }
  }

  if (provider && PROVIDER_CONTEXT_WINDOWS[provider]) {
    return PROVIDER_CONTEXT_WINDOWS[provider];
  }

  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}
