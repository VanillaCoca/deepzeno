import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseRetryModel,
  ProviderCircuitBreaker,
  providerKeyForModel,
} from "../../lib/ai/resilience.ts";

describe("providerKeyForModel", () => {
  it("uses the serving-endpoint prefix of the model id", () => {
    assert.equal(providerKeyForModel("deepseek:default"), "deepseek");
    assert.equal(providerKeyForModel("bedrock:claude-sonnet-4-6"), "bedrock");
    assert.equal(
      providerKeyForModel("gateway:moonshotai/kimi-k2.5"),
      "gateway"
    );
  });
});

describe("ProviderCircuitBreaker", () => {
  it("stays closed below the failure threshold", () => {
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 3 });
    breaker.recordFailure("deepseek");
    breaker.recordFailure("deepseek");
    assert.equal(breaker.isOpen("deepseek"), false);
  });

  it("opens after consecutive failures reach the threshold", () => {
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure("deepseek");
    }
    assert.equal(breaker.isOpen("deepseek"), true);
    // Other providers are unaffected.
    assert.equal(breaker.isOpen("anthropic"), false);
  });

  it("resets on success", () => {
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 2 });
    breaker.recordFailure("deepseek");
    breaker.recordSuccess("deepseek");
    breaker.recordFailure("deepseek");
    assert.equal(breaker.isOpen("deepseek"), false);
  });

  it("half-opens after the cooldown elapses", () => {
    let now = 0;
    const breaker = new ProviderCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      now: () => now,
    });
    breaker.recordFailure("deepseek");
    assert.equal(breaker.isOpen("deepseek"), true);
    now = 1001;
    assert.equal(breaker.isOpen("deepseek"), false);
  });

  it("re-opens immediately when the half-open probe fails", () => {
    let now = 0;
    const breaker = new ProviderCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      now: () => now,
    });
    breaker.recordFailure("deepseek");
    now = 1001;
    assert.equal(breaker.isOpen("deepseek"), false);
    breaker.recordFailure("deepseek");
    assert.equal(breaker.isOpen("deepseek"), true);
  });
});

describe("chooseRetryModel", () => {
  const env = {
    ANTHROPIC_API_KEY: "x",
    DEEPSEEK_API_KEY: "x",
  } as Record<string, string | undefined>;

  it("retries on a different model when one is available", () => {
    const retry = chooseRetryModel("deepseek:default", "economy", env);
    assert.equal(retry, "anthropic:claude-sonnet-4-6");
  });

  it("returns null when no alternative model exists", () => {
    const only = { DEEPSEEK_API_KEY: "x" } as Record<
      string,
      string | undefined
    >;
    assert.equal(chooseRetryModel("deepseek:default", "economy", only), null);
  });
});
