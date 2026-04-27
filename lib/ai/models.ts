type EnvLike = Record<string, string | undefined>;

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ModelProviderType =
  | "anthropic"
  | "openai"
  | "openai-compatible"
  | "gateway";

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  description: string;
  capabilities: ModelCapabilities;
  providerType: ModelProviderType;
  gatewayOrder?: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
};

type ChatModelDefinition = ChatModel & {
  envKeys: readonly string[];
  resolveModelId?: (env: EnvLike) => string | null;
  staticModelId?: string;
  resolveName?: (env: EnvLike) => string;
};

export type ResolvedChatModel = ChatModel & {
  providerModelId: string;
};

export const DEFAULT_CHAT_MODEL = "anthropic:claude-sonnet-4-6";

const modelCatalog: ChatModelDefinition[] = [
  {
    id: "anthropic:claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    providerLabel: "Anthropic",
    description: "Strong default model for planning, coding, and long chats.",
    capabilities: {
      tools: true,
      vision: true,
      reasoning: false,
    },
    providerType: "anthropic",
    envKeys: ["ANTHROPIC_API_KEY"],
    staticModelId: "claude-sonnet-4-6",
  },
  {
    id: "openai:gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    providerLabel: "OpenAI",
    description:
      "Reliable general-purpose model with strong instruction following.",
    capabilities: {
      tools: true,
      vision: true,
      reasoning: false,
    },
    providerType: "openai",
    envKeys: ["OPENAI_API_KEY"],
    staticModelId: "gpt-4.1",
  },
  {
    id: "dashscope:default",
    name: "DashScope Compatible",
    provider: "alibaba",
    providerLabel: "DashScope",
    description: "OpenAI-compatible model routed through DashScope.",
    capabilities: {
      tools: false,
      vision: false,
      reasoning: false,
    },
    providerType: "openai-compatible",
    envKeys: ["DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL", "DASHSCOPE_MODEL"],
    resolveModelId: (env) => env.DASHSCOPE_MODEL ?? null,
    resolveName: (env) => {
      const configuredModel = env.DASHSCOPE_MODEL;
      if (!configuredModel) {
        return "DashScope Compatible";
      }

      return `${humanizeModelName(configuredModel)} (DashScope)`;
    },
  },
  {
    id: "deepseek:default",
    name: "DeepSeek",
    provider: "deepseek",
    providerLabel: "DeepSeek",
    description:
      "DeepSeek's OpenAI-compatible chat model for coding and reasoning.",
    capabilities: {
      tools: false,
      vision: false,
      reasoning: false,
    },
    providerType: "openai-compatible",
    envKeys: ["DEEPSEEK_API_KEY"],
    resolveModelId: (env) => env.DEEPSEEK_MODEL ?? "deepseek-chat",
    resolveName: (env) => {
      const configuredModel = env.DEEPSEEK_MODEL ?? "deepseek-chat";
      return `${humanizeModelName(configuredModel)} (DeepSeek)`;
    },
  },
  {
    id: "gateway:moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    provider: "moonshotai",
    providerLabel: "AI Gateway",
    description:
      "Existing AI Gateway path retained for template compatibility.",
    capabilities: {
      tools: true,
      vision: false,
      reasoning: false,
    },
    providerType: "gateway",
    envKeys: ["AI_GATEWAY_API_KEY"],
    staticModelId: "moonshotai/kimi-k2.5",
    gatewayOrder: ["fireworks", "bedrock"],
  },
];

function humanizeModelName(modelId: string) {
  return modelId
    .split(/[/:_-]+/)
    .filter(Boolean)
    .map((segment) => {
      const normalized = segment.toLowerCase();

      if (normalized === "gpt") {
        return "GPT";
      }

      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(" ");
}

export const chatModels: ChatModel[] = modelCatalog.map(
  ({
    envKeys: _envKeys,
    resolveModelId: _resolveModelId,
    resolveName,
    staticModelId: _staticModelId,
    ...model
  }) => ({
    ...model,
    name: resolveName ? resolveName({}) : model.name,
  })
);

function isConfigured(model: ChatModelDefinition, env: EnvLike) {
  return model.envKeys.every((key) => Boolean(env[key]));
}

function resolveModel(
  model: ChatModelDefinition,
  env: EnvLike
): ResolvedChatModel | null {
  if (!isConfigured(model, env)) {
    return null;
  }

  const providerModelId = model.resolveModelId
    ? model.resolveModelId(env)
    : (model.staticModelId ?? null);

  if (!providerModelId) {
    return null;
  }

  return {
    ...model,
    name: model.resolveName ? model.resolveName(env) : model.name,
    providerModelId,
  };
}

export function getActiveModels(
  env: EnvLike = process.env
): ResolvedChatModel[] {
  return modelCatalog
    .map((model) => resolveModel(model, env))
    .filter((model): model is ResolvedChatModel => Boolean(model));
}

export function getCapabilities(env: EnvLike = process.env) {
  return Object.fromEntries(
    getActiveModels(env).map((model) => [model.id, model.capabilities])
  ) as Record<string, ModelCapabilities>;
}

export function getModelById(id: string, env: EnvLike = process.env) {
  return getActiveModels(env).find((model) => model.id === id) ?? null;
}

export function resolveChatModelSelection(
  id: string | undefined,
  env: EnvLike = process.env
) {
  const activeModels = getActiveModels(env);

  if (activeModels.length === 0) {
    return null;
  }

  return (
    activeModels.find((model) => model.id === id) ??
    activeModels.find((model) => model.id === DEFAULT_CHAT_MODEL) ??
    activeModels[0]
  );
}

export function getDefaultModelId(env: EnvLike = process.env) {
  const preferredIds = [
    DEFAULT_CHAT_MODEL,
    "openai:gpt-4.1",
    "deepseek:default",
    "dashscope:default",
    "gateway:moonshotai/kimi-k2.5",
  ];
  const activeModels = getActiveModels(env);

  return (
    preferredIds.find((id) => activeModels.some((model) => model.id === id)) ??
    activeModels[0]?.id ??
    DEFAULT_CHAT_MODEL
  );
}

export function getTitleModelId(env: EnvLike = process.env) {
  const preferredIds = [
    "openai:gpt-4.1",
    "anthropic:claude-sonnet-4-6",
    "deepseek:default",
    "dashscope:default",
    "gateway:moonshotai/kimi-k2.5",
  ];

  for (const id of preferredIds) {
    const resolved = getModelById(id, env);
    if (resolved) {
      return resolved.id;
    }
  }

  return getDefaultModelId(env);
}
