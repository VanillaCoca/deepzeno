import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickModelByTier,
  selectModelForTask,
} from "../../lib/ai/model-policy.ts";
import { getDefaultModelId } from "../../lib/ai/models.ts";

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
