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
// Optionally restrict to vision-capable models.
export function pickModel(
  { tier, requireVision = false }: { tier: ModelTier; requireVision?: boolean },
  env: EnvLike = process.env
): string {
  const active = getActiveModels(env);
  if (active.length === 0) {
    return getDefaultModelId(env);
  }
  const eligible = requireVision
    ? active.filter((model) => model.capabilities.vision)
    : active;
  const pool = eligible.length > 0 ? eligible : active;
  const target = TIER_RANK[tier];
  const [best] = [...pool].sort(
    (a, b) => tierDistance(a.tier, target) - tierDistance(b.tier, target)
  );
  return best.id;
}

export function pickModelByTier(
  tier: ModelTier,
  env: EnvLike = process.env
): string {
  return pickModel({ tier }, env);
}

// ---------------------------------------------------------------------------
// Auto model router (P2)
// ---------------------------------------------------------------------------

export type AutoRoutingSignals = {
  text: string;
  hasImage: boolean;
};

const HARD_SIGNAL =
  /\b(explain|analy[sz]e|design|architect|debug|prove|derive|refactor|optimi[sz]e|research|compare|evaluate|plan)\b/i;
const CODE_FENCE = /```/;
const TRIVIAL_MAX_CHARS = 40;
const HARD_MAX_CHARS = 2000;

export function classifyTier(text: string): ModelTier {
  const trimmed = text.trim();
  if (
    HARD_SIGNAL.test(trimmed) ||
    trimmed.length > HARD_MAX_CHARS ||
    CODE_FENCE.test(trimmed)
  ) {
    return "frontier";
  }
  if (trimmed.length < TRIVIAL_MAX_CHARS) {
    return "economy";
  }
  return "standard";
}

const TIER_BY_RANK: ModelTier[] = ["economy", "standard", "frontier"];

const PREFERENCE_SHIFT: Record<QualityPreference, number> = {
  economy: -1,
  balanced: 0,
  best: 1,
};

function shiftTier(tier: ModelTier, preference: QualityPreference): ModelTier {
  const shifted = TIER_RANK[tier] + PREFERENCE_SHIFT[preference];
  const clamped = Math.max(0, Math.min(TIER_BY_RANK.length - 1, shifted));
  return TIER_BY_RANK[clamped];
}

export function routeAutoModel(
  signals: AutoRoutingSignals,
  preference: QualityPreference,
  env: EnvLike = process.env
): string {
  const tier = shiftTier(classifyTier(signals.text), preference);
  return pickModel({ tier, requireVision: signals.hasImage }, env);
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
