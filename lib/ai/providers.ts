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
