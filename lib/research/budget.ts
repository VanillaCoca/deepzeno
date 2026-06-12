// Per-run budgets for the research pipeline (spec: env-tunable caps with
// defaults; over budget → land partial results, never a silent failure).

export type ResearchBudget = {
  maxSearches: number;
  maxFetches: number;
  maxEvidence: number;
  maxCandidates: number;
};

export const RESEARCH_BUDGET_DEFAULTS: ResearchBudget = {
  maxSearches: 6,
  maxFetches: 10,
  maxEvidence: 12,
  maxCandidates: 5,
};

function readPositiveNumber(raw: string | undefined, fallback: number) {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveResearchBudget(
  env: Record<string, string | undefined> = process.env
): ResearchBudget {
  return {
    maxSearches: readPositiveNumber(
      env.ZENO_RESEARCH_MAX_SEARCHES,
      RESEARCH_BUDGET_DEFAULTS.maxSearches
    ),
    maxFetches: readPositiveNumber(
      env.ZENO_RESEARCH_MAX_FETCHES,
      RESEARCH_BUDGET_DEFAULTS.maxFetches
    ),
    maxEvidence: readPositiveNumber(
      env.ZENO_RESEARCH_MAX_EVIDENCE,
      RESEARCH_BUDGET_DEFAULTS.maxEvidence
    ),
    maxCandidates: readPositiveNumber(
      env.ZENO_RESEARCH_MAX_CANDIDATES,
      RESEARCH_BUDGET_DEFAULTS.maxCandidates
    ),
  };
}
