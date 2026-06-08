import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CompactionCandidate,
  planCompaction,
} from "../../lib/context/compaction-plan.ts";
import {
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTextTokens,
} from "../../lib/context/token-estimate.ts";

function msgs(count: number, tokens: number): CompactionCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    tokens,
  }));
}

describe("token estimation", () => {
  it("returns 0 for empty text", () => {
    assert.equal(estimateTextTokens(""), 0);
  });

  it("estimates latin text at roughly 4 chars per token", () => {
    assert.equal(estimateTextTokens("a".repeat(8)), 2);
  });

  it("counts CJK characters more heavily than latin", () => {
    // 4 CJK chars -> ~4 tokens, far more than 4 latin chars (~1 token).
    assert.equal(estimateTextTokens("决定必须"), 4);
    assert.ok(estimateTextTokens("决定必须") > estimateTextTokens("abcd"));
  });

  it("adds per-message overhead and reads text parts", () => {
    assert.equal(
      estimateMessageTokens({ parts: [{ type: "text", text: "abcd" }] }),
      1 + 8
    );
  });

  it("sums tokens across messages", () => {
    const total = estimateMessagesTokens([
      { parts: [{ type: "text", text: "abcd" }] },
      { parts: [{ type: "text", text: "abcd" }] },
    ]);
    assert.equal(total, 18);
  });
});

describe("planCompaction", () => {
  const base = {
    systemTokens: 100,
    windowTokens: 1000,
    triggerRatio: 0.7,
    keepRecent: 2,
    minFold: 2,
    projectedSummaryTokens: 100,
  };

  it("does not compact when under budget", () => {
    const plan = planCompaction({ ...base, messages: msgs(3, 100) });
    assert.equal(plan.shouldCompact, false);
    assert.equal(plan.foldIds.length, 0);
    assert.equal(plan.keepIds.length, 3);
  });

  it("folds the oldest messages until the payload fits", () => {
    const plan = planCompaction({ ...base, messages: msgs(20, 100) });
    assert.equal(plan.shouldCompact, true);
    // budget 700, base (100 system + 100 summary) = 200 -> keep <= 500 -> 5 msgs.
    assert.equal(plan.keepIds.length, 5);
    assert.equal(plan.foldIds.length, 15);
    // Recent messages are the kept ones.
    assert.equal(plan.keepIds.at(-1), "m19");
    assert.equal(plan.foldIds[0], "m0");
    assert.ok(plan.projectedTokens <= plan.budgetTokens);
  });

  it("never folds below the keepRecent floor even if still over budget", () => {
    const plan = planCompaction({
      ...base,
      messages: msgs(10, 1000),
    });
    assert.equal(plan.shouldCompact, true);
    assert.equal(plan.keepIds.length, 2); // keepRecent floor
    assert.equal(plan.foldIds.length, 8);
  });

  it("skips compaction when too few messages would be folded", () => {
    // Over budget, but only 1 message is foldable (9 - keepRecent 8).
    const plan = planCompaction({
      ...base,
      keepRecent: 8,
      minFold: 6,
      messages: msgs(9, 100),
    });
    assert.equal(plan.shouldCompact, false);
    assert.equal(plan.foldIds.length, 0);
  });
});
