import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addUsage,
  computeCostEstimate,
  type ModelsUsedAccumulator,
  meterCostUsd,
} from "@/lib/billing/cost-core";

describe("addUsage", () => {
  it("accumulates across calls for the same key", () => {
    const acc: ModelsUsedAccumulator = {};
    addUsage(acc, "deepseek:default", { inputTokens: 100, outputTokens: 20 });
    addUsage(acc, "deepseek:default", { inputTokens: 400, outputTokens: 80 });
    assert.deepEqual(acc["deepseek:default"], {
      inputTokens: 500,
      outputTokens: 100,
    });
  });

  it("treats missing usage as zero rather than NaN", () => {
    // Providers routinely omit one side of the usage object. Arithmetic on
    // undefined poisons the whole total silently — a NaN allowance charge
    // compares false against every threshold, i.e. it never limits anything.
    const acc: ModelsUsedAccumulator = {};
    addUsage(acc, "deepseek:default", { inputTokens: 10 });
    addUsage(acc, "deepseek:default", { outputTokens: null });
    assert.deepEqual(acc["deepseek:default"], {
      inputTokens: 10,
      outputTokens: 0,
    });
  });
});

describe("computeCostEstimate", () => {
  it("prices a known model at its published rate", () => {
    // 1M in @ $3 + 1M out @ $15.
    const cost = computeCostEstimate({
      "anthropic:claude-sonnet-4-6": {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
    });
    assert.equal(cost, 18);
  });

  it("returns null when nothing priced was used", () => {
    // The honest answer to "what did this cost" is "unknown". Returning 0 here
    // is how a UI ends up permanently claiming a frontier run was free.
    assert.equal(
      computeCostEstimate({
        "openrouter:claude-opus-4-8": {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        },
      }),
      null
    );
  });

  it("returns null for search pseudo-keys alone", () => {
    assert.equal(
      computeCostEstimate({
        "search:tavily": { inputTokens: 0, outputTokens: 0 },
      }),
      null
    );
  });

  it("returns null on an empty accumulator", () => {
    assert.equal(computeCostEstimate({}), null);
  });

  it("sums only the priced keys when the run mixed both", () => {
    // Deliberately partial: reporting undercounts rather than guesses.
    const cost = computeCostEstimate({
      "deepseek:default": { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "openrouter:gpt-5.5": { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "search:tavily": { inputTokens: 0, outputTokens: 0 },
    });
    assert.ok(cost !== null);
    assert.equal(Number(cost.toFixed(6)), 0.42);
  });
});

describe("meterCostUsd", () => {
  it("agrees with the estimate when every model is priced", () => {
    const modelsUsed: ModelsUsedAccumulator = {
      "anthropic:claude-sonnet-4-6": {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
    };
    const metered = meterCostUsd(modelsUsed);
    assert.equal(metered.usd, 18);
    assert.deepEqual(metered.pricedKeys, ["anthropic:claude-sonnet-4-6"]);
    assert.deepEqual(metered.estimatedKeys, []);
    assert.equal(metered.usd, computeCostEstimate(modelsUsed));
  });

  it("charges an unpriced frontier model at the frontier stand-in rate", () => {
    // This is the case the two functions are built to disagree on: reporting
    // says "unknown", rationing says "$90 of your allowance". Charging zero
    // here would make the allowance unenforceable through exactly the path
    // most likely to be expensive.
    const modelsUsed: ModelsUsedAccumulator = {
      "openrouter:claude-opus-4-8": {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
    };
    const metered = meterCostUsd(modelsUsed);
    assert.equal(metered.usd, 90);
    assert.equal(computeCostEstimate(modelsUsed), null);
    assert.deepEqual(metered.estimatedKeys, ["openrouter:claude-opus-4-8"]);
    assert.deepEqual(metered.pricedKeys, []);
  });

  it("uses the model's own tier, not a single global fallback", () => {
    // dashscope is economy, gateway kimi is standard. Billing both at the
    // frontier rate would make the free tier absurdly small; billing both at
    // the economy rate would make it unbounded.
    assert.equal(
      meterCostUsd({
        "dashscope:default": { inputTokens: 1_000_000, outputTokens: 0 },
      }).usd,
      1
    );
    assert.equal(
      meterCostUsd({
        "gateway:moonshotai/kimi-k2.5": {
          inputTokens: 1_000_000,
          outputTokens: 0,
        },
      }).usd,
      3
    );
  });

  it("never returns null, even with nothing metered", () => {
    const metered = meterCostUsd({});
    assert.equal(metered.usd, 0);
    assert.deepEqual(metered.pricedKeys, []);
    assert.deepEqual(metered.estimatedKeys, []);
  });

  it("skips keys that are not models at all", () => {
    // A search fee is real money but it is not token-denominated; pricing it
    // per token would be inventing a number, which is worse than the known
    // undercount recorded in the design note.
    const metered = meterCostUsd({
      "search:gateway-perplexity": {
        inputTokens: 5_000_000,
        outputTokens: 5_000_000,
      },
    });
    assert.equal(metered.usd, 0);
    assert.deepEqual(metered.estimatedKeys, []);
  });

  it("never under-charges relative to the reported estimate", () => {
    // The invariant that makes the split safe: whatever the user is shown,
    // the allowance is charged at least that much.
    const modelsUsed: ModelsUsedAccumulator = {
      "deepseek:default": { inputTokens: 2_000_000, outputTokens: 500_000 },
      "bedrock-openai:gpt-5.5": {
        inputTokens: 300_000,
        outputTokens: 100_000,
      },
      "search:tavily": { inputTokens: 0, outputTokens: 0 },
    };
    const estimate = computeCostEstimate(modelsUsed) ?? 0;
    const metered = meterCostUsd(modelsUsed);
    assert.ok(metered.usd >= estimate);
    assert.deepEqual(metered.pricedKeys, ["deepseek:default"]);
    assert.deepEqual(metered.estimatedKeys, ["bedrock-openai:gpt-5.5"]);
  });
});
