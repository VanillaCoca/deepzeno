// Central model-routing policy.
//
// Every internal/background task that needs a model should ask here instead of
// hard-coding a model id. This is the single seam through which cost-aware
// routing (P2 "Auto", P3 research orchestration) will later flow.
//
// P1 is deliberately behavior-preserving: the tasks that exist today
// (ir_extraction, compaction_summary, title) return exactly the model they
// already use. The tier-based path (pickModelByTier) is groundwork for the
// not-yet-wired tasks (semantic_search, research_*).

import {
  getActiveModels,
  getDefaultModelId,
  getTitleModelId,
  type ModelTier,
} from "@/lib/ai/models";

type EnvLike = Record<string, string | undefined>;

export type ModelTask =
  | "conversation"
  | "ir_extraction"
  | "compaction_summary"
  | "title"
  | "semantic_search"
  | "research_plan"
  | "research_worker"
  | "research_synthesis";

// User-facing cost/quality knob; tasks shift their target tier accordingly.
export type QualityPreference = "economy" | "balanced" | "best";

const TIER_RANK: Record<ModelTier, number> = {
  economy: 0,
  standard: 1,
  frontier: 2,
};

// Distance from a model's tier to the desired tier, biased to prefer a
// cheaper (lower) tier over a more expensive (higher) one when neither matches.
function tierDistance(modelTier: ModelTier, target: number): number {
  const rank = TIER_RANK[modelTier];
  if (rank === target) {
    return 0;
  }
  return rank < target ? target - rank : rank - target + 0.5;
}

// Pick the active model closest to the desired tier (preferring cheaper on a
// tie), falling back to the default model when nothing is configured.
export function pickModelByTier(
  tier: ModelTier,
  env: EnvLike = process.env
): string {
  const active = getActiveModels(env);
  if (active.length === 0) {
    return getDefaultModelId(env);
  }

  const target = TIER_RANK[tier];
  const [best] = [...active].sort(
    (a, b) => tierDistance(a.tier, target) - tierDistance(b.tier, target)
  );
  return best.id;
}

export function selectModelForTask(
  task: ModelTask,
  options: { env?: EnvLike; userModelId?: string | null } = {}
): string {
  const env = options.env ?? process.env;

  switch (task) {
    // Foreground chat is user-driven; honor the user's pick (or the default).
    case "conversation":
      return options.userModelId ?? getDefaultModelId(env);

    // Behavior-preserving: these already run on getDefaultModelId today.
    case "ir_extraction":
    case "compaction_summary":
      return getDefaultModelId(env);

    case "title":
      return getTitleModelId(env);

    // Not yet wired (P2/P3); tier-based groundwork.
    case "semantic_search":
    case "research_worker":
      return pickModelByTier("economy", env);
    case "research_plan":
      return pickModelByTier("standard", env);
    case "research_synthesis":
      return pickModelByTier("frontier", env);

    default:
      return getDefaultModelId(env);
  }
}
