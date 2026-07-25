import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider, gateway } from "ai";
import { isTestEnvironment } from "../constants";
import { getModelById, getTitleModelId } from "./models";

const anthropicProvider = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openaiProvider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Amazon Bedrock, Anthropic-native transport. Bearer API key takes precedence
// over SigV4, so we only need BEDROCK_API_KEY + AWS_REGION (us-east-2).
const bedrockProvider = process.env.BEDROCK_API_KEY
  ? createAmazonBedrock({
      apiKey: process.env.BEDROCK_API_KEY,
      region: process.env.AWS_REGION ?? "us-east-2",
    })
  : null;

// The Bedrock mantle endpoint exposes TWO distinct surfaces, and the OpenAI
// flagships live on only one of them:
//
//   .../v1/chat/completions        generic OpenAI-compatible surface. Serves the
//                                  open-weight / third-party models (gpt-oss,
//                                  qwen, glm, ...). Rejects openai.gpt-5.x.
//   .../openai/v1/responses        OpenAI-native surface. The ONLY route that
//                                  serves openai.gpt-5.4 / 5.5 / 5.6.
//
// Calling gpt-5.x on the first surface returns HTTP 400 "does not support the
// '/v1/chat/completions' API", which the app surfaced as an empty assistant
// message. So the flagships must ride @ai-sdk/openai's Responses transport
// against the /openai/v1 base, not the openai-compatible chat transport.
//
// BEDROCK_MANTLE_BASE_URL stays pointed at .../v1 (the compatible surface);
// the OpenAI base is derived from it so only one env var has to be maintained.
function mantleOpenAIBaseURL(baseURL: string): string {
  // https://bedrock-mantle.<region>.api.aws/v1 -> .../openai/v1
  return baseURL.replace(/\/v1\/?$/, "/openai/v1");
}

const bedrockMantleProvider =
  process.env.BEDROCK_MANTLE_API_KEY && process.env.BEDROCK_MANTLE_BASE_URL
    ? createOpenAI({
        apiKey: process.env.BEDROCK_MANTLE_API_KEY,
        baseURL: mantleOpenAIBaseURL(process.env.BEDROCK_MANTLE_BASE_URL),
        name: "bedrock-openai",
      })
    : null;

const dashscopeProvider =
  process.env.DASHSCOPE_API_KEY && process.env.DASHSCOPE_BASE_URL
    ? createOpenAICompatible({
        apiKey: process.env.DASHSCOPE_API_KEY,
        baseURL: process.env.DASHSCOPE_BASE_URL,
        name: "dashscope",
      })
    : null;

const deepseekProvider = process.env.DEEPSEEK_API_KEY
  ? createOpenAICompatible({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      name: "deepseek",
    })
  : null;

// OpenRouter (OpenAI-compatible) — temporary stand-in for the Bedrock flagships
// (Opus 4.8, GPT-5.5) while AWS model access is pending. Gated only on
// OPENROUTER_API_KEY: remove that key to drop these from the active set once
// Bedrock is enabled. No code change needed to switch back.
const openrouterProvider = process.env.OPENROUTER_API_KEY
  ? createOpenAICompatible({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL:
        process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      name: "openrouter",
    })
  : null;

export const myProvider = isTestEnvironment
  ? (() => {
      const { chatModel, titleModel } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": titleModel,
        },
      });
    })()
  : null;

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("chat-model");
  }

  const model = getModelById(modelId, process.env);

  if (!model) {
    throw new Error(
      "No configured AI model matches the current selection. Check your environment variables."
    );
  }

  switch (model.providerType) {
    case "anthropic":
      return anthropicProvider.chat(model.providerModelId);
    case "openai":
      return openaiProvider.chat(model.providerModelId);
    case "bedrock":
      if (!bedrockProvider) {
        throw new Error("Amazon Bedrock is not configured.");
      }

      return bedrockProvider(model.providerModelId);
    case "openai-compatible":
      if (model.id.startsWith("dashscope:")) {
        if (!dashscopeProvider) {
          throw new Error("DashScope is not configured.");
        }

        return dashscopeProvider.chatModel(model.providerModelId);
      }

      if (model.id.startsWith("deepseek:")) {
        if (!deepseekProvider) {
          throw new Error("DeepSeek is not configured.");
        }

        return deepseekProvider.chatModel(model.providerModelId);
      }

      if (model.id.startsWith("bedrock-openai:")) {
        if (!bedrockMantleProvider) {
          throw new Error("Bedrock (OpenAI) is not configured.");
        }

        // Responses API, not chat completions — see the comment on
        // bedrockMantleProvider above.
        return bedrockMantleProvider.responses(model.providerModelId);
      }

      if (model.id.startsWith("openrouter:")) {
        if (!openrouterProvider) {
          throw new Error("OpenRouter is not configured.");
        }

        return openrouterProvider.chatModel(model.providerModelId);
      }

      throw new Error("Unsupported OpenAI-compatible provider.");
    case "gateway":
      return gateway.languageModel(model.providerModelId);
    default:
      throw new Error("Unsupported AI model provider.");
  }
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }

  return getLanguageModel(getTitleModelId(process.env));
}
