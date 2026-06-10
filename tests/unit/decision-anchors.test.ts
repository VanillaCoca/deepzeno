import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidCodeAnchor } from "../../lib/decision-anchors.ts";

// MCP write routing has no unit surface anymore by design: since the
// candidate-first reversal (constitution Iron Law 4), submitRoutedCandidate is
// the only write primitive in lib/mcp/service.ts and there is no direct-write
// code path left to classify.

describe("isValidCodeAnchor", () => {
  it("accepts valid file anchors", () => {
    assert.equal(
      isValidCodeAnchor({
        repo: "owner/repo",
        file: "lib/mcp/service.ts",
        line_start: 10,
        line_end: 20,
        commit_sha: "abc123",
        captured_at: "2026-05-06T00:00:00.000Z",
      }),
      true
    );
  });

  it("rejects missing files, invalid dates, and inverted line ranges", () => {
    assert.equal(
      isValidCodeAnchor({
        captured_at: "2026-05-06T00:00:00.000Z",
      }),
      false
    );
    assert.equal(
      isValidCodeAnchor({
        file: "app/api/mcp/route.ts",
        captured_at: "not-a-date",
      }),
      false
    );
    assert.equal(
      isValidCodeAnchor({
        file: "app/api/mcp/route.ts",
        line_start: 12,
        line_end: 11,
        captured_at: "2026-05-06T00:00:00.000Z",
      }),
      false
    );
  });
});
