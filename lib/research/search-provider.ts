// Pure helper — no server-only import so node:test can import this directly.

export type SearchProvider = "anthropic" | "openai" | "gateway-perplexity";

// Single source of truth for the "no provider configured" message — used by
// both the pipeline pre-flight (pipeline.ts) and searchWeb (search.ts).
export const SEARCH_PROVIDER_MISSING_MESSAGE =
  "No web search provider is configured (need ANTHROPIC_API_KEY, OPENAI_API_KEY, or AI_GATEWAY_API_KEY).";

/**
 * Resolves which web-search provider to use based on available API keys.
 * Priority: Anthropic → OpenAI → AI Gateway (Perplexity).
 * Returns null when no provider is configured.
 */
export function resolveSearchProvider(
  env: Record<string, string | undefined> = process.env
): SearchProvider | null {
  if (env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }

  if (env.OPENAI_API_KEY) {
    return "openai";
  }

  if (env.AI_GATEWAY_API_KEY) {
    return "gateway-perplexity";
  }

  return null;
}
