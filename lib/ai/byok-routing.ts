// Which user-suppliable credential, if any, a given model id runs on.
//
// Pure lookup, no imports from the provider module, so `plan-core` consumers
// and unit tests can ask the question without pulling in the whole AI SDK.
//
// The mapping is by model id prefix rather than by `providerType` because
// `providerType: "openai-compatible"` covers four different vendors with four
// different keys — routing on it would happily bill a DeepSeek call to an
// OpenRouter key.

export type ByokProviderId =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "openrouter"
  | "dashscope"
  | "gateway"
  | "tavily";

/**
 * Returns null for models that cannot be user-funded.
 *
 * `bedrock:` and `bedrock-openai:` are deliberately excluded. Their credential
 * is an AWS account bearer token scoped to a region and a set of enabled model
 * grants — asking a user to paste one would be asking them to hand over far
 * more access than "pay for your own tokens", and Iron Law 1 (never own the
 * execution environment) cuts the same way for other people's cloud accounts.
 * Bedrock therefore stays platform-funded and stays inside the allowance.
 */
export function byokProviderForModelId(modelId: string): ByokProviderId | null {
  if (modelId.startsWith("anthropic:")) {
    return "anthropic";
  }
  if (modelId.startsWith("openai:")) {
    return "openai";
  }
  if (modelId.startsWith("deepseek:")) {
    return "deepseek";
  }
  if (modelId.startsWith("openrouter:")) {
    return "openrouter";
  }
  if (modelId.startsWith("dashscope:")) {
    return "dashscope";
  }
  if (modelId.startsWith("gateway:")) {
    return "gateway";
  }
  return null;
}

/**
 * Providers whose keys pay for tokens (as opposed to search calls).
 *
 * Used for the watch-quota question "does this user fund their own patrols",
 * where a Tavily key alone is not enough — it covers the search leg but the
 * model leg would still be on the platform.
 */
export const MODEL_BYOK_PROVIDERS: readonly ByokProviderId[] = [
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "dashscope",
  "gateway",
];
