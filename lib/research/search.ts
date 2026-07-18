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
