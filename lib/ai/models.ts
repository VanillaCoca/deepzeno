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
  | "gateway"
  | "bedrock";

// Capability/cost tier used by the model-routing policy:
// - economy: cheap/fast; bulk background work (extraction, summarization, retrieval)
// - standard: balanced default chat / planning
// - frontier: most capable; reserved for hard reasoning and final synthesis
export type ModelTier = "economy" | "standard" | "frontier";

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  description: string;
  capabilities: ModelCapabilities;
  providerType: ModelProviderType;
  // Routing metadata. `tier` drives task→model policy; `contextWindowTokens`
  // is the single source of truth for compaction budgeting. Costs are USD per
  // 1M tokens, or null when the underlying model is env-configurable/unknown.
  tier: ModelTier;
  contextWindowTokens: number;
  inputCostPerMTok: number | null;
  outputCostPerMTok: number | null;
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
    tier: "standard",
    contextWindowTokens: 200_000,
    inputCostPerMTok: 3,
    outputCostPerMTok: 15,
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
    tier: "standard",
    contextWindowTokens: 1_000_000,
    inputCostPerMTok: 2,
    outputCostPerMTok: 8,
    envKeys: ["OPENAI_API_KEY"],
    staticModelId: "gpt-4.1",
  },
  // --- Amazon Bedrock: Anthropic-native transport via @ai-sdk/amazon-bedrock
  //     (Bearer API key auth, no IAM SigV4). Region + key come from env; model
  //     ids are us.* cross-region inference profiles. Sonnet is active now;
  //     flagships below stay hidden until BEDROCK_FLAGSHIPS_ENABLED is set
  //     (grant day = flip one env var + redeploy, zero code change). ---
  {
    id: "bedrock:claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Bedrock)",
    provider: "anthropic",
    providerLabel: "Amazon Bedrock",
    description:
      "Claude Sonnet 4.6 served through Amazon Bedrock for unified billing.",
    capabilities: {
      tools: true,
      vision: true,
      reasoning: false,
    },
    providerType: "bedrock",
    tier: "standard",
    contextWindowTokens: 200_000,
    inputCostPerMTok: 3,
    outputCostPerMTok: 15,
    envKeys: ["BEDROCK_API_KEY", "AWS_REGION"],
    staticModelId: "us.anthropic.claude-sonnet-4-6",
  },
  {
    id: "bedrock:claude-opus-4-8",
    name: "Claude Opus 4.8",
    provider: "anthropic",
    providerLabel: "Amazon Bedrock",
    description:
      "Most capable Claude model; reserved for hard reasoning and final synthesis.",
    capabilities: {
      tools: true,
      vision: true,
      reasoning: true,
    },
    providerType: "bedrock",
    tier: "frontier",
    contextWindowTokens: 200_000,
    inputCostPerMTok: 15,
    outputCostPerMTok: 75,
    reasoningEffort: "medium",
    envKeys: ["BEDROCK_API_KEY", "AWS_REGION", "BEDROCK_FLAGSHIPS_ENABLED"],
    staticModelId: "us.anthropic.claude-opus-4-8",
  },
  // --- OpenAI flagships via Bedrock's mantle endpoint. These speak the
  //     OpenAI Chat Completions shape (Bearer auth), so they reuse the existing
  //     openai-compatible transport with a Bedrock-specific baseURL. ---
  {
    id: "bedrock-openai:gpt-5.5",
    name: "GPT-5.5",
    provider: "openai",
    providerLabel: "Amazon Bedrock",
    description:
      "OpenAI flagship via Bedrock; strong reasoning for hard problems.",
    capabilities: {
      tools: true,
      vision: true,
      reasoning: true,
    },
    providerType: "openai-compatible",
    tier: "frontier",
    // TODO(pricing): confirm GPT-5.5 Bedrock rates before relying on cost routing.
    contextWindowTokens: 400_000,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
    reasoningEffort: "medium",
    envKeys: [
      "BEDROCK_MANTLE_API_KEY",
      "BEDROCK_MANTLE_BASE_URL",
      "BEDROCK_FLAGSHIPS_ENABLED",
    ],
    staticModelId: "openai.gpt-5.5",
  },
  {
    id: "bedrock-openai:gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    providerLabel: "Amazon Bedrock",
    description:
      "Fast OpenAI flagship via Bedrock for everyday substantive chat.",
    capabilities: {
      tools: true,
      vision: true,
      reasoning: false,
    },
    providerType: "openai-compatible",
    tier: "standard",
    // TODO(pricing): confirm GPT-5.4 Bedrock rates before relying on cost routing.
    contextWindowTokens: 400_000,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
    envKeys: [
      "BEDROCK_MANTLE_API_KEY",
      "BEDROCK_MANTLE_BASE_URL",
      "BEDROCK_FLAGSHIPS_ENABLED",
    ],
    staticModelId: "openai.gpt-5.4",
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
    tier: "economy",
    contextWindowTokens: 32_000,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
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
    tier: "economy",
    contextWindowTokens: 64_000,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
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
    tier: "standard",
    contextWindowTokens: 128_000,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
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

// Look up a catalog entry by id without requiring env configuration.
// Used by the research pipeline to price token usage after a run completes.
// Returns null when the id is not in the catalog (e.g. "search:gateway-perplexity").
export function findModelById(id: string): ChatModelDefinition | null {
  return modelCatalog.find((m) => m.id === id) ?? null;
}

export function getTitleModelId(env: EnvLike = process.env) {
  const preferredIds = [
    // Bedrock first: it's the deployment's reachable provider (direct OpenAI /
    // Anthropic can be geo-blocked), so titles get AI-generated instead of
    // falling back to the message text.
    "bedrock:claude-sonnet-4-6",
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
