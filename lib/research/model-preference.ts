// Pure helper — no server-only import so node:test can import this directly.
//
// Which model powers the research agent (L2 "Research this" + Watchtower
// patrols). The product default is DeepSeek: research is bulk background
// reasoning where the economy endpoint is the right cost point, and the
// schema-prompt shim (lib/ai/schema-prompt.ts) makes its structured output
// reliable. Users can override per project (agent settings) or per watch;
// when the chosen model isn't configured, tier routing takes over.

import { getActiveModels } from "@/lib/ai/models";

type EnvLike = Record<string, string | undefined>;

export const DEFAULT_RESEARCH_MODEL_ID = "deepseek:default";

// The model preference to use when the project has none stored: DeepSeek if
// its key is configured, otherwise null (= existing tier routing).
export function defaultResearchModelId(
  env: EnvLike = process.env
): string | null {
  return getActiveModels(env).some(
    (model) => model.id === DEFAULT_RESEARCH_MODEL_ID
  )
    ? DEFAULT_RESEARCH_MODEL_ID
    : null;
}

// Normalize a stored preference: an unknown/inactive model id falls back to
// the default chain rather than silently sticking (a stale setting must not
// wedge research after a provider is unconfigured).
export function normalizeResearchModelId(
  stored: string | null | undefined,
  env: EnvLike = process.env
): string | null {
  if (stored && getActiveModels(env).some((model) => model.id === stored)) {
    return stored;
  }
  return defaultResearchModelId(env);
}
