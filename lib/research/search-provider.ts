// Pure helper — no server-only import so node:test can import this directly.

export type SearchProvider =
  | "tavily"
  | "anthropic"
  | "openai"
  | "gateway-perplexity"
  | "fixtures";

// Single source of truth for the "no provider configured" message — used by
// both the pipeline pre-flight (pipeline.ts) and searchWeb (search.ts).
export const SEARCH_PROVIDER_MISSING_MESSAGE =
  "No web search provider is configured (need TAVILY_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or AI_GATEWAY_API_KEY).";

/**
 * Local canned search/fetch fixtures for offline smoke tests and evals.
 * Triple-gated so no deployment can ever serve fixture data: the env var
 * must be set explicitly, and both Vercel and production builds refuse it.
 */
export function fixturesDir(
  env: Record<string, string | undefined> = process.env
): string | null {
  if (
    env.ZENO_SEARCH_FIXTURES_DIR &&
    !env.VERCEL &&
    env.NODE_ENV !== "production"
  ) {
    return env.ZENO_SEARCH_FIXTURES_DIR;
  }
  return null;
}

/**
 * Resolves which web-search provider to use based on available API keys.
 * Priority: fixtures (dev/test only) → Tavily → Anthropic → OpenAI → AI
 * Gateway (Perplexity). Returns null when no provider is configured.
 *
 * Tavily outranks the other three because it is the only one that answers the
 * question this function actually asks. `searchWeb` wants `query → {url,title}[]`
 * and throws the prose away; the model-side branches reach that shape by paying
 * a language model to run a search tool and then discarding everything but
 * `result.sources`. Tavily returns the URLs directly, for zero tokens — so it
 * is strictly cheaper than every branch below it for identical output, before
 * its free tier is even considered.
 */
export function resolveSearchProvider(
  env: Record<string, string | undefined> = process.env
): SearchProvider | null {
  if (fixturesDir(env)) {
    return "fixtures";
  }

  if (env.TAVILY_API_KEY) {
    return "tavily";
  }

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
