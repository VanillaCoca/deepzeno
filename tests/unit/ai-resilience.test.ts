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

  // The retry fires immediately after a failure, which makes it the most
  // likely call in the system to land on an endpoint already known to be
  // down. These cover the breaker actually being consulted.
  const openBreaker = (...open: string[]) => ({
    isOpen: (provider: string) => open.includes(provider),
  });

  it("skips a circuit-broken provider in favor of a healthy one", () => {
    const three = {
      ANTHROPIC_API_KEY: "x",
      OPENAI_API_KEY: "x",
      DEEPSEEK_API_KEY: "x",
    } as Record<string, string | undefined>;
    // Without a breaker, anthropic wins the tie on array order.
    assert.equal(
      chooseRetryModel("deepseek:default", "economy", three),
      "anthropic:claude-sonnet-4-6"
    );
    assert.equal(
      chooseRetryModel(
        "deepseek:default",
        "economy",
        three,
        openBreaker("anthropic")
      ),
      "openai:gpt-4.1"
    );
  });

  it("prefers a healthy sibling model over a broken different provider", () => {
    // The case the old sort got wrong: "different provider" was a preference,
    // not a health check, so it handed the retry to a burning endpoint while
    // a healthy model sat on the same provider that had just blipped once.
    const env2 = {
      ANTHROPIC_API_KEY: "x",
      BEDROCK_API_KEY: "x",
      AWS_REGION: "us-east-1",
      BEDROCK_FLAGSHIPS_ENABLED: "1",
    } as Record<string, string | undefined>;
    assert.equal(
      chooseRetryModel(
        "bedrock:claude-sonnet-4-6",
        "standard",
        env2,
        openBreaker("anthropic")
      ),
      "bedrock:claude-opus-4-8"
    );
  });

  it("still retries when every alternative endpoint is broken", () => {
    // Returning null here would turn a recoverable blip into a hard run
    // failure, and the half-open rule already bounds how long "open" lasts.
    assert.equal(
      chooseRetryModel(
        "deepseek:default",
        "economy",
        env,
        openBreaker("anthropic", "deepseek")
      ),
      "anthropic:claude-sonnet-4-6"
    );
  });
});
