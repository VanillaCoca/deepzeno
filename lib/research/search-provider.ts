// Pure helper — no server-only import so node:test can import this directly.

export type SearchProvider = "anthropic" | "openai" | "gateway-perplexity";

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
