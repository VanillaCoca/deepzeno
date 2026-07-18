import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  appendSchemaToSystem,
  needsSchemaInPrompt,
  systemForModel,
} from "../../lib/ai/schema-prompt.ts";
import {
  defaultResearchModelId,
  normalizeResearchModelId,
} from "../../lib/research/model-preference.ts";

const schema = z.object({
  intents: z.array(z.object({ query: z.string(), goal: z.string() })),
});

describe("needsSchemaInPrompt", () => {
  it("flags openai-compatible endpoints (schema is dropped by the SDK)", () => {
    assert.equal(needsSchemaInPrompt("deepseek:default"), true);
    assert.equal(needsSchemaInPrompt("dashscope:default"), true);
  });

  it("leaves native structured-output transports untouched", () => {
    assert.equal(needsSchemaInPrompt("anthropic:claude-sonnet-4-6"), false);
    assert.equal(needsSchemaInPrompt("openai:gpt-4.1"), false);
    assert.equal(needsSchemaInPrompt("bedrock:claude-sonnet-4-6"), false);
  });

  it("treats unknown models as native (no prompt bloat on typos)", () => {
    assert.equal(needsSchemaInPrompt("nope:unknown"), false);
  });
});

describe("appendSchemaToSystem", () => {
  it("embeds the serialized JSON Schema and mentions JSON", () => {
    const out = appendSchemaToSystem("Base instructions.", schema);
    assert.ok(out.startsWith("Base instructions."));
    assert.match(out, /JSON Schema/);
    assert.match(out, /"intents"/);
    assert.match(out, /"query"/);
  });
});

describe("systemForModel", () => {
  it("appends only for models that need it", () => {
    const base = "Base.";
    assert.equal(
      systemForModel("anthropic:claude-sonnet-4-6", base, schema),
      base
    );
    assert.notEqual(systemForModel("deepseek:default", base, schema), base);
  });
});

describe("research model preference", () => {
  const withDeepseek = { DEEPSEEK_API_KEY: "x" } as Record<
    string,
    string | undefined
  >;
  const withoutDeepseek = { ANTHROPIC_API_KEY: "x" } as Record<
    string,
    string | undefined
  >;

  it("defaults to DeepSeek when its key is configured", () => {
    assert.equal(defaultResearchModelId(withDeepseek), "deepseek:default");
  });

  it("returns null (tier routing) when DeepSeek is not configured", () => {
    assert.equal(defaultResearchModelId(withoutDeepseek), null);
  });

  it("keeps a stored preference only while that model is active", () => {
    assert.equal(
      normalizeResearchModelId("anthropic:claude-sonnet-4-6", withoutDeepseek),
      "anthropic:claude-sonnet-4-6"
    );
    // Stale/inactive stored id → default chain, never the stale id.
    assert.equal(
      normalizeResearchModelId("deepseek:default", withoutDeepseek),
      null
    );
    assert.equal(
      normalizeResearchModelId("nope:unknown", withDeepseek),
      "deepseek:default"
    );
  });
});
