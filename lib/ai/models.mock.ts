import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

const mockResponses: Record<string, string> = {
  default: "This is a mock response for testing.",
  weather: "The weather in San Francisco is sunny and 72°F.",
  greeting: "Hello! How can I help you today?",
  inlineMarker:
    "Understood. This is a scoped decision for review. [[ir:plan:decision|Inline marker test excludes BYOK|The user explicitly converged on this boundary for the test project.]]",
};

const mockUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const mockFinishReason = { unified: "stop" as const, raw: "stop" as const };

function getResponseForPrompt(prompt: unknown): string {
  const promptStr = JSON.stringify(prompt).toLowerCase();

  if (promptStr.includes("weather") || promptStr.includes("temperature")) {
    return mockResponses.weather;
  }

  if (promptStr.includes("inline marker test")) {
    return mockResponses.inlineMarker;
  }

  if (
    promptStr.includes("hello") ||
    promptStr.includes("hi") ||
    promptStr.includes("hey")
  ) {
    return mockResponses.greeting;
  }

  return mockResponses.default;
}

function createGenerateResult(text: string): LanguageModelV3GenerateResult {
  return {
    finishReason: mockFinishReason,
    usage: mockUsage,
    content: [{ type: "text", text }],
    warnings: [],
  };
}

function createStreamChunks(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: mockFinishReason, usage: mockUsage },
  ];
}

export const chatModel = new MockLanguageModelV3({
  doGenerate: async ({ prompt }) =>
    createGenerateResult(getResponseForPrompt(prompt)),
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      initialDelayInMs: 150,
      chunkDelayInMs: 75,
      chunks: createStreamChunks(getResponseForPrompt(prompt)),
    }),
  }),
});

export const titleModel = new MockLanguageModelV3({
  doGenerate: createGenerateResult("Test Conversation"),
  doStream: async () => ({
    stream: simulateReadableStream({
      initialDelayInMs: 100,
      chunkDelayInMs: 50,
      chunks: createStreamChunks("Test Conversation"),
    }),
  }),
});
