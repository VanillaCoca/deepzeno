// Structured generation with runtime degradation: route via the task policy,
// and when the chosen model's endpoint errors, feed the circuit breaker and
// retry ONCE on the best alternative (different provider preferred, same tier
// target). Every routing decision — normal, degraded, exhausted — is logged as
// a structured line so routing behavior can be tuned from real logs.

import { generateObject } from "ai";
import type { z } from "zod";

import {
  type ModelTask,
  selectModelForTask,
  TASK_TIER,
} from "@/lib/ai/model-policy";
import { classifyProviderFailure } from "@/lib/ai/provider-failure-core";
import { getLanguageModel, runsOnUserKey } from "@/lib/ai/providers";
import {
  chooseRetryModel,
  providerBreaker,
  providerKeyForModel,
} from "@/lib/ai/resilience";
import { systemForModel } from "@/lib/ai/schema-prompt";

type Usage = { inputTokens?: number | null; outputTokens?: number | null };

export type ResilientGenerateResult<T> = {
  object: T;
  usage: Usage;
  // The model that actually produced the result (retry model when degraded).
  modelId: string;
  degraded: boolean;
};

function logRouting(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ type: "model_routing", ...entry }));
}

export async function generateObjectResilient<T>({
  task,
  system,
  prompt,
  schema,
  preferredModelId,
}: {
  task: ModelTask;
  system: string;
  prompt: string;
  schema: z.Schema<T>;
  // Explicit model preference (e.g. the project's research-agent model,
  // DeepSeek by default). The policy validates it (active + healthy) and
  // falls back to tier routing when it can't be honored.
  preferredModelId?: string | null;
}): Promise<ResilientGenerateResult<T>> {
  const primaryId = selectModelForTask(task, {
    userModelId: preferredModelId ?? null,
  });
  const primaryProvider = providerKeyForModel(primaryId);

  try {
    const result = await generateObject({
      model: getLanguageModel(primaryId),
      // Models without native json_schema support get the schema serialized
      // into the system prompt (schema-prompt.ts) — otherwise it's dropped.
      system: systemForModel(primaryId, system, schema),
      prompt,
      schema,
    });
    providerBreaker.recordSuccess(primaryProvider);
    logRouting({ task, modelId: primaryId, outcome: "ok" });
    return {
      object: result.object,
      usage: result.usage,
      modelId: primaryId,
      degraded: false,
    };
  } catch (primaryError) {
    // Before anything else: was this the provider's failure, or this user's?
    //
    // Degrading was built for outages, and both of its effects are wrong for a
    // dead credential. Tripping `providerBreaker` on a 401 lets one tenant's
    // revoked key open the circuit for every other tenant on the deployment —
    // a shared health signal poisoned by a private fact. And retrying on
    // another provider moves the call onto a model the user has no key for,
    // which means the platform pays for a user who explicitly opted out of
    // being paid for, and never finds out their key stopped working. Both are
    // silent, which is what makes them worse than the error they replace.
    //
    // So: user key + credential failure = stop here. The wrapper in
    // providers.ts has already marked the key invalid, so the *next* call runs
    // on the free allowance with the settings dialog saying why.
    if (
      classifyProviderFailure(primaryError).kind === "credential" &&
      runsOnUserKey(primaryId)
    ) {
      logRouting({
        task,
        modelId: primaryId,
        outcome: "failed_user_credential",
        error:
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError),
      });
      throw primaryError;
    }

    providerBreaker.recordFailure(primaryProvider);

    const tier = TASK_TIER[task];
    const retryId = tier ? chooseRetryModel(primaryId, tier) : null;
    const primaryMessage =
      primaryError instanceof Error
        ? primaryError.message
        : String(primaryError);

    if (!retryId) {
      logRouting({
        task,
        modelId: primaryId,
        outcome: "failed_no_alternative",
        error: primaryMessage,
      });
      throw primaryError;
    }

    logRouting({
      task,
      modelId: retryId,
      outcome: "degraded",
      degradedFrom: primaryId,
      // Whether the failure above was the one that tripped the primary
      // endpoint's breaker. A degrade with this false is a blip; a run of
      // degrades with it true is an outage, and the two want different
      // responses from you. The distinction was already in memory and was
      // simply never written down.
      primaryBreakerOpen: providerBreaker.isOpen(primaryProvider),
      error: primaryMessage,
    });

    try {
      const result = await generateObject({
        model: getLanguageModel(retryId),
        system: systemForModel(retryId, system, schema),
        prompt,
        schema,
      });
      providerBreaker.recordSuccess(providerKeyForModel(retryId));
      return {
        object: result.object,
        usage: result.usage,
        modelId: retryId,
        degraded: true,
      };
    } catch (retryError) {
      // Same split as above. The retry model may itself be one the user funds
      // — two connected keys, both dead — and a private credential must not
      // reach the shared breaker from this arm either.
      if (
        !(
          classifyProviderFailure(retryError).kind === "credential" &&
          runsOnUserKey(retryId)
        )
      ) {
        providerBreaker.recordFailure(providerKeyForModel(retryId));
      }

      logRouting({
        task,
        modelId: retryId,
        outcome: "failed_after_degrade",
        degradedFrom: primaryId,
        error:
          retryError instanceof Error ? retryError.message : String(retryError),
      });
      throw retryError;
    }
  }
}
