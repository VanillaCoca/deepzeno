import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Import from the pure module — search.ts imports "server-only" which throws
// in plain node:test. resolveSearchProvider is pure and lives in search-provider.ts.
import { resolveSearchProvider } from "../../lib/research/search-provider.ts";

describe("resolveSearchProvider", () => {
  it("prefers anthropic, then openai, then gateway", () => {
    assert.equal(
      resolveSearchProvider({ ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k" }),
      "anthropic"
    );
    assert.equal(
      resolveSearchProvider({ OPENAI_API_KEY: "k", AI_GATEWAY_API_KEY: "k" }),
      "openai"
    );
    assert.equal(
      resolveSearchProvider({ AI_GATEWAY_API_KEY: "k" }),
      "gateway-perplexity"
    );
    assert.equal(resolveSearchProvider({}), null);
  });

  it("treats empty-string keys as absent", () => {
    assert.equal(
      resolveSearchProvider({ ANTHROPIC_API_KEY: "", AI_GATEWAY_API_KEY: "k" }),
      "gateway-perplexity"
    );
  });
});
