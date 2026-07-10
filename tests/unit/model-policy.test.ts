import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTier,
  pickModel,
  pickModelByTier,
  routeAutoModel,
  selectModelForTask,
} from "../../lib/ai/model-policy.ts";
import { getDefaultModelId } from "../../lib/ai/models.ts";
import { ProviderCircuitBreaker } from "../../lib/ai/resilience.ts";

// Active models depend on which env keys are present.
const sonnetAndDeepseek = {
  ANTHROPIC_API_KEY: "x",
  DEEPSEEK_API_KEY: "x",
} as Record<string, string | undefined>;

const deepseekOnly = {
  DEEPSEEK_API_KEY: "x",
} as Record<string, string | undefined>;

describe("pickModelByTier", () => {
  it("picks an economy model for the economy tier", () => {
    assert.equal(
      pickModelByTier("economy", sonnetAndDeepseek),
      "deepseek:default"
    );
  });

  it("picks the nearest higher tier when the target tier is absent", () => {
    // No frontier configured -> falls back to the standard model (Sonnet).
    assert.equal(
      pickModelByTier("frontier", sonnetAndDeepseek),
      "anthropic:claude-sonnet-4-6"
    );
  });

  it("picks the standard model for the standard tier", () => {
    assert.equal(
      pickModelByTier("standard", sonnetAndDeepseek),
      "anthropic:claude-sonnet-4-6"
    );
  });

  it("falls back to the only configured model regardless of tier", () => {
    assert.equal(pickModelByTier("frontier", deepseekOnly), "deepseek:default");
  });

  it("skips models whose provider breaker is open", () => {
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure("deepseek");

    assert.equal(
      pickModel({ tier: "economy", breaker }, sonnetAndDeepseek),
      "anthropic:claude-sonnet-4-6"
    );
  });

  it("uses the full pool when every provider breaker is open", () => {
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure("deepseek");

    // A tripped breaker must never leave routing with zero models.
    assert.equal(
      pickModel({ tier: "economy", breaker }, deepseekOnly),
      "deepseek:default"
    );
  });
});

describe("selectModelForTask", () => {
  it("is behavior-preserving for IR extraction (== getDefaultModelId)", () => {
    assert.equal(
      selectModelForTask("ir_extraction", { env: sonnetAndDeepseek }),
      getDefaultModelId(sonnetAndDeepseek)
    );
  });

  it("is behavior-preserving for compaction summary", () => {
    assert.equal(
      selectModelForTask("compaction_summary", { env: sonnetAndDeepseek }),
      getDefaultModelId(sonnetAndDeepseek)
    );
  });

  it("honors the user's model for conversation", () => {
    assert.equal(
      selectModelForTask("conversation", {
        env: sonnetAndDeepseek,
        userModelId: "openai:gpt-4.1",
      }),
      "openai:gpt-4.1"
    );
  });

  it("routes research workers to economy and synthesis to the top tier", () => {
    assert.equal(
      selectModelForTask("research_worker", { env: sonnetAndDeepseek }),
      "deepseek:default"
    );
    assert.equal(
      selectModelForTask("research_synthesis", { env: sonnetAndDeepseek }),
      "anthropic:claude-sonnet-4-6"
    );
  });
});

describe("classifyTier", () => {
  it("treats short plain messages as economy", () => {
    assert.equal(classifyTier("hi there"), "economy");
  });

  it("treats reasoning-keyword messages as frontier", () => {
    assert.equal(classifyTier("Explain the tradeoffs here"), "frontier");
  });

  it("treats fenced code as frontier", () => {
    assert.equal(classifyTier("fix this\n```\ncode\n```"), "frontier");
  });

  it("treats a normal medium sentence as standard", () => {
    assert.equal(
      classifyTier(
        "I want to add a settings page that lists the user's saved topics."
      ),
      "standard"
    );
  });

  it("does NOT send a plain summary/write request to frontier (thinking)", () => {
    assert.equal(
      classifyTier(
        "Please write a short summary of yesterday's meeting notes."
      ),
      "standard"
    );
  });

  it("sends genuine reasoning requests to frontier (thinking)", () => {
    assert.equal(
      classifyTier("Prove that the sum of two even numbers is even"),
      "frontier"
    );
    assert.equal(
      classifyTier("Think hard about whether this design scales"),
      "frontier"
    );
  });
});

describe("routeAutoModel", () => {
  it("routes a trivial turn to economy (DeepSeek)", () => {
    assert.equal(
      routeAutoModel(
        { text: "hi", hasImage: false },
        "balanced",
        sonnetAndDeepseek
      ),
      "deepseek:default"
    );
  });

  it("routes a hard turn to the top available tier", () => {
    assert.equal(
      routeAutoModel(
        {
          text: "Debug this algorithm and prove its complexity",
          hasImage: false,
        },
        "balanced",
        sonnetAndDeepseek
      ),
      "anthropic:claude-sonnet-4-6"
    );
  });

  it("Best shifts a trivial turn up a tier", () => {
    assert.equal(
      routeAutoModel(
        { text: "hi", hasImage: false },
        "best",
        sonnetAndDeepseek
      ),
      "anthropic:claude-sonnet-4-6"
    );
  });

  it("Economy keeps a trivial turn at economy", () => {
    assert.equal(
      routeAutoModel(
        { text: "hi", hasImage: false },
        "economy",
        sonnetAndDeepseek
      ),
      "deepseek:default"
    );
  });

  it("requires a vision-capable model when an image is attached", () => {
    assert.equal(
      routeAutoModel(
        { text: "hi", hasImage: true },
        "balanced",
        sonnetAndDeepseek
      ),
      "anthropic:claude-sonnet-4-6"
    );
  });
});
