import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RESEARCH_BUDGET_DEFAULTS,
  resolveResearchBudget,
} from "../../lib/research/budget.ts";

describe("resolveResearchBudget", () => {
  it("falls back to defaults", () => {
    assert.deepEqual(resolveResearchBudget({}), RESEARCH_BUDGET_DEFAULTS);
  });

  it("reads positive numeric overrides and rejects junk", () => {
    const budget = resolveResearchBudget({
      ZENO_RESEARCH_MAX_SEARCHES: "3",
      ZENO_RESEARCH_MAX_FETCHES: "junk",
      ZENO_RESEARCH_MAX_CANDIDATES: "-2",
    });
    assert.equal(budget.maxSearches, 3);
    assert.equal(budget.maxFetches, RESEARCH_BUDGET_DEFAULTS.maxFetches);
    assert.equal(budget.maxCandidates, RESEARCH_BUDGET_DEFAULTS.maxCandidates);
  });
});
