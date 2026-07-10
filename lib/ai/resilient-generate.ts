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
import { getLanguageModel } from "@/lib/ai/providers";
import {
  chooseRetryModel,
  providerBreaker,
  providerKeyForModel,
} from "@/lib/ai/resilience";

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
}: {
  task: ModelTask;
  system: string;
  prompt: string;
  schema: z.Schema<T>;
}): Promise<ResilientGenerateResult<T>> {
  const primaryId = selectModelForTask(task);
  const primaryProvider = providerKeyForModel(primaryId);

  try {
    const result = await generateObject({
      model: getLanguageModel(primaryId),
      system,
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
      error: primaryMessage,
    });

    try {
      const result = await generateObject({
        model: getLanguageModel(retryId),
        system,
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
      providerBreaker.recordFailure(providerKeyForModel(retryId));
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
