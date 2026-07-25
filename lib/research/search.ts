import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { gateway, generateText, type ToolSet } from "ai";

import {
  fixturesDir,
  resolveSearchProvider,
  SEARCH_PROVIDER_MISSING_MESSAGE,
  type SearchProvider,
} from "./search-provider";

export type { SearchProvider } from "./search-provider";
export {
  resolveSearchProvider,
  SEARCH_PROVIDER_MISSING_MESSAGE,
} from "./search-provider";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ResearchToolUnavailableError extends Error {
  statusCode = 503;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebSearchResult = { url: string; title: string | null };
export type WebSearchOutcome = {
  results: WebSearchResult[];
  provider: SearchProvider;
  usage: { inputTokens: number; outputTokens: number };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupeSources(
  sources: Array<{ sourceType: string; url?: string; title?: string }>
): WebSearchResult[] {
  const seen = new Set<string>();
  const results: WebSearchResult[] = [];

  for (const source of sources) {
    if (source.sourceType !== "url" || !source.url || seen.has(source.url)) {
      continue;
    }

    seen.add(source.url);
    results.push({ url: source.url, title: source.title ?? null });
  }

  return results;
}

// ---------------------------------------------------------------------------
// searchWeb
// ---------------------------------------------------------------------------

// Fixture search: `${dir}/search.json` is
// { "queries": { "<key>": [{url,title}] }, "default": [{url,title}] } —
// exact key match first, then the first key contained in the query, then
// the default list. Dev/test only (gated in search-provider.ts).
async function searchFixtures(
  query: string,
  dir: string
): Promise<WebSearchOutcome> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const raw = JSON.parse(await readFile(join(dir, "search.json"), "utf8")) as {
    queries?: Record<string, WebSearchResult[]>;
    default?: WebSearchResult[];
  };
  const queries = raw.queries ?? {};
  const exact = queries[query];
  const partialKey = Object.keys(queries).find((key) => query.includes(key));
  const results =
    exact ?? (partialKey ? queries[partialKey] : raw.default) ?? [];
  return {
    results,
    provider: "fixtures",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

// ---------------------------------------------------------------------------
// Tavily
// ---------------------------------------------------------------------------

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const TAVILY_TIMEOUT_MS = 10_000;
// One search costs one credit at basic depth, two at advanced. Advanced buys
// deeper crawling of each result's body — which this pipeline does not want,
// because it fetches and quote-verifies the pages itself (fetch-page.ts). We
// are buying URLs, so we buy them at the cheap depth.
const TAVILY_SEARCH_DEPTH = "basic";
// The per-run budget allows 10 fetches across up to 6 searches, so a search
// returning more than a handful of URLs is returning URLs that will never be
// read.
const TAVILY_MAX_RESULTS = 8;

// A key that is missing, revoked, or out of credit fails identically for every
// intent in the run. Letting the pipeline absorb those as six per-intent
// failures would land a thin "partial" result that reads as "we looked and the
// web was quiet" — Iron Law 2 in its most dangerous form, since the user acts
// on a partial. These statuses fail the run out loud instead.
const TAVILY_FATAL_STATUSES = new Set([401, 403, 429, 432, 433]);

type TavilyResponse = {
  results?: Array<{ url?: string; title?: string }>;
};

async function searchTavily(query: string): Promise<WebSearchOutcome> {
  let response: Response;

  try {
    response = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        search_depth: TAVILY_SEARCH_DEPTH,
        max_results: TAVILY_MAX_RESULTS,
      }),
      signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
    });
  } catch (error) {
    // Network-level: transient by assumption, so it stays a per-intent failure.
    throw new Error(
      `Tavily search failed: ${error instanceof Error ? error.message : "network error"}`
    );
  }

  if (!response.ok) {
    const detail = `Tavily search failed with HTTP ${response.status}.`;

    if (TAVILY_FATAL_STATUSES.has(response.status)) {
      throw new ResearchToolUnavailableError(
        `${detail} The key is missing, rejected, or out of credit — check TAVILY_API_KEY.`
      );
    }

    throw new Error(detail);
  }

  const payload = (await response.json()) as TavilyResponse;

  return {
    // Reuse the same deduper the model-side branches use so every provider
    // hands the pipeline one shape.
    results: dedupeSources(
      (payload.results ?? []).map((item) => ({
        sourceType: "url",
        url: item.url,
        title: item.title,
      }))
    ),
    provider: "tavily",
    // Genuinely zero. No language model is involved, and reporting a token
    // count here would put a fabricated number into the run's cost estimate.
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export async function searchWeb(query: string): Promise<WebSearchOutcome> {
  const provider = resolveSearchProvider();

  if (!provider) {
    throw new ResearchToolUnavailableError(SEARCH_PROVIDER_MISSING_MESSAGE);
  }

  if (provider === "fixtures") {
    const dir = fixturesDir();
    if (!dir) {
      throw new ResearchToolUnavailableError(SEARCH_PROVIDER_MISSING_MESSAGE);
    }
    return await searchFixtures(query, dir);
  }

  if (provider === "tavily") {
    return await searchTavily(query);
  }

  if (provider === "anthropic") {
    const anthropicProvider = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const result = await generateText({
      model: anthropicProvider.languageModel("claude-sonnet-4-6"),
      prompt: `Search the web for: ${query}\nReturn nothing but a one-line summary; the sources are what matters.`,
      tools: {
        web_search: anthropicProvider.tools.webSearch_20250305({ maxUses: 1 }),
      } as ToolSet,
    });

    return {
      results: dedupeSources(result.sources),
      provider,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
    };
  }

  if (provider === "openai") {
    // The responses API (openaiProvider.responses()) is required for
    // openai.tools.webSearch — the chat completions API does not support it.
    const openaiProvider = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const result = await generateText({
      model: openaiProvider.responses("gpt-4.1"),
      prompt: `Search the web for: ${query}\nReturn nothing but a one-line summary; the sources are what matters.`,
      tools: { web_search: openaiProvider.tools.webSearch({}) } as ToolSet,
      toolChoice: { type: "tool", toolName: "web_search" },
    });

    return {
      results: dedupeSources(result.sources),
      provider,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
    };
  }

  // gateway-perplexity: sonar model returns sources natively, no tool needed.
  const result = await generateText({
    model: gateway.languageModel("perplexity/sonar"),
    prompt: `${query}\nAnswer briefly; cite your sources.`,
  });

  return {
    results: dedupeSources(result.sources),
    provider,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
}
