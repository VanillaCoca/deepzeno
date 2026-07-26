import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  customProvider,
  gateway,
  type LanguageModelMiddleware,
  wrapLanguageModel,
} from "ai";
import { markProviderKeyInvalid } from "@/lib/billing/queries";
import { isTestEnvironment } from "../constants";
import { byokKeyForProvider, getBillingContext } from "./billing-context";
import { type ByokProviderId, byokProviderForModelId } from "./byok-routing";
import { getModelById, getTitleModelId } from "./models";
import { classifyProviderFailure } from "./provider-failure-core";

// Platform providers: the operator's own credentials, funding the free
// allowance. A user who has connected their own key never touches these — see
// `userKeyFor` below and lib/ai/billing-context.ts for why the switch is
// ambient rather than a parameter.

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

// ---------------------------------------------------------------------------
// Per-user routing
// ---------------------------------------------------------------------------

// Providers are rebuilt per call when a user key is in play. That looks
// wasteful and is not: `createX` only closes over config — no socket, no
// handshake — and it runs once per generate call, not once per token. Caching
// them by key would mean holding decrypted user credentials in a module-level
// map for the lifetime of the lambda, which is a strictly worse trade.
function userKeyFor(modelId: string): string | null {
  return byokKeyForProvider(byokProviderForModelId(modelId));
}

/**
 * Whether this call will spend the *user's* money rather than the platform's.
 *
 * Exported for the resilience layer, which has to answer a question it could
 * not ask before BYOK: when a call fails, is the failure the provider's or the
 * caller's? Returns the boolean and never the key — nothing outside this
 * module needs the credential itself.
 */
export function runsOnUserKey(modelId: string): boolean {
  const model = getModelById(modelId, process.env);
  return model ? userKeyFor(model.id) !== null : false;
}

/**
 * Take a user's key out of rotation when the provider says it cannot fund
 * calls, and record why so the settings dialog can say it.
 *
 * This is the promise `lib/billing/validate-key.ts` makes when it refuses to
 * block a key its probe dislikes: "the durable mechanism fires on the real
 * request path, with the real payload". Until this existed, that promise was
 * only true for keys that failed to decrypt — a key revoked at the provider
 * stayed `active` forever and every patrol, sweep and message the user ran
 * kept failing with nothing anywhere pointing at the cause.
 *
 * Fire-and-forget: a failed model call must not become a failed model call AND
 * an unhandled rejection, and the user's error is already on its way up the
 * stack. `markProviderKeyInvalid` swallows its own write errors.
 */
function reportUserKeyFailure({
  userId,
  provider,
  error,
}: {
  userId: string;
  provider: ByokProviderId;
  error: unknown;
}): void {
  const failure = classifyProviderFailure(error, provider);

  if (failure.kind !== "credential") {
    return;
  }

  console.warn("Disabling a user provider key the provider refused", {
    userId,
    provider,
    statusCode: failure.statusCode,
  });

  markProviderKeyInvalid({
    userId,
    provider,
    reason: failure.reason,
  }).catch((writeError) => {
    console.error("Failed to mark provider key invalid", {
      provider,
      error:
        writeError instanceof Error ? writeError.message : String(writeError),
    });
  });
}

/**
 * Watch one user-funded model call for credential failures.
 *
 * Applied here rather than in each of the eleven call sites for the ordinary
 * reason: a call site that forgets it produces a user whose dead key never gets
 * flagged, and there is no way to notice that from the outside.
 *
 * Both arms are needed. `wrapGenerate` covers extraction, sweep, kickoff and
 * every structured call; `wrapStream` covers chat, which is the path a user is
 * most likely to be sitting in front of when their key dies. Streams report
 * failures two different ways — a rejected `doStream()` for an auth error
 * caught at connect time, and an `error` part mid-stream for one caught after
 * the response opened — so both are inspected.
 */
function userKeyGuard(
  userId: string,
  provider: ByokProviderId
): LanguageModelMiddleware {
  const report = (error: unknown) =>
    reportUserKeyFailure({ userId, provider, error });

  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      try {
        return await doGenerate();
      } catch (error) {
        report(error);
        throw error;
      }
    },
    wrapStream: async ({ doStream }) => {
      try {
        const { stream, ...rest } = await doStream();

        return {
          ...rest,
          stream: stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                if (chunk.type === "error") {
                  report(chunk.error);
                }
                controller.enqueue(chunk);
              },
            })
          ),
        };
      } catch (error) {
        report(error);
        throw error;
      }
    },
  };
}

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

  const provider = byokProviderForModelId(model.id);
  const userKey = provider ? byokKeyForProvider(provider) : null;
  const resolved = resolveLanguageModel(model, userKey);

  if (!(provider && userKey)) {
    return resolved;
  }

  // No context means no user to attribute the failure to. That should be
  // impossible — a user key can only be in scope because `withUserFunding` put
  // it there — but guessing an owner is worse than skipping the bookkeeping.
  const userId = getBillingContext()?.userId;

  return userId
    ? wrapLanguageModel({
        model: resolved,
        middleware: userKeyGuard(userId, provider),
      })
    : resolved;
}

function resolveLanguageModel(
  model: NonNullable<ReturnType<typeof getModelById>>,
  userKey: string | null
) {
  switch (model.providerType) {
    case "anthropic":
      return (
        userKey ? createAnthropic({ apiKey: userKey }) : anthropicProvider
      ).chat(model.providerModelId);
    case "openai":
      return (
        userKey ? createOpenAI({ apiKey: userKey }) : openaiProvider
      ).chat(model.providerModelId);
    case "bedrock":
      if (!bedrockProvider) {
        throw new Error("Amazon Bedrock is not configured.");
      }

      return bedrockProvider(model.providerModelId);
    case "openai-compatible":
      if (model.id.startsWith("dashscope:")) {
        if (userKey && process.env.DASHSCOPE_BASE_URL) {
          return createOpenAICompatible({
            apiKey: userKey,
            baseURL: process.env.DASHSCOPE_BASE_URL,
            name: "dashscope",
          }).chatModel(model.providerModelId);
        }
        if (!dashscopeProvider) {
          throw new Error("DashScope is not configured.");
        }

        return dashscopeProvider.chatModel(model.providerModelId);
      }

      if (model.id.startsWith("deepseek:")) {
        if (userKey) {
          return createOpenAICompatible({
            apiKey: userKey,
            baseURL:
              process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
            name: "deepseek",
          }).chatModel(model.providerModelId);
        }
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
        if (userKey) {
          return createOpenAICompatible({
            apiKey: userKey,
            baseURL:
              process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
            name: "openrouter",
          }).chatModel(model.providerModelId);
        }
        if (!openrouterProvider) {
          throw new Error("OpenRouter is not configured.");
        }

        return openrouterProvider.chatModel(model.providerModelId);
      }

      throw new Error("Unsupported OpenAI-compatible provider.");
    case "gateway":
      if (userKey) {
        return createGateway({ apiKey: userKey }).languageModel(
          model.providerModelId
        );
      }
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
