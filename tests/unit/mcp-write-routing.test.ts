import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidCodeAnchor } from "../../lib/decision-anchors.ts";
import { classifyWrite } from "../../lib/mcp/write-routing.ts";

describe("classifyWrite", () => {
  const highUserConfirmed = {
    confirmed_by_user_id: "user-1",
    weight: "high",
    kind: "plan",
  };

  const highUnconfirmed = {
    confirmed_by_user_id: null,
    weight: "high",
    kind: "plan",
  };

  it("routes routine creates directly", () => {
    assert.equal(
      classifyWrite({ tool: "create_decision", proposed_kind: "plan" }),
      "direct"
    );
  });

  it("routes rejection and constraint creates to candidates", () => {
    assert.equal(
      classifyWrite({ tool: "create_decision", proposed_kind: "rejection" }),
      "candidate"
    );
    assert.equal(
      classifyWrite({ tool: "create_decision", proposed_kind: "constraint" }),
      "candidate"
    );
  });

  it("routes updates that change kind to rejection or constraint to candidates", () => {
    assert.equal(
      classifyWrite({ tool: "update_decision", next_kind: "rejection" }),
      "candidate"
    );
    assert.equal(
      classifyWrite({ tool: "update_decision", next_kind: "constraint" }),
      "candidate"
    );
  });

  it("routes supersede and archive of user-confirmed high-weight truth to candidates", () => {
    assert.equal(
      classifyWrite({
        tool: "supersede_decision",
        target_decision: highUserConfirmed,
      }),
      "candidate"
    );
    assert.equal(
      classifyWrite({
        tool: "archive_decision",
        target_decision: highUserConfirmed,
      }),
      "candidate"
    );
  });

  it("does not protect high-weight truth until it is user confirmed", () => {
    assert.equal(
      classifyWrite({
        tool: "supersede_decision",
        target_decision: highUnconfirmed,
      }),
      "direct"
    );
  });
});

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
