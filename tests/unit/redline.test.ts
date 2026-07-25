import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeRedline, type RedlineSegment } from "../../lib/ir/redline.ts";

function join(segments: RedlineSegment[], type: RedlineSegment["type"]): string {
  return segments
    .filter((segment) => segment.type === type)
    .map((segment) => segment.text)
    .join("");
}

// The old truth is unchanged+deleted; the new one is unchanged+inserted.
function rebuildOld(segments: RedlineSegment[]): string {
  return segments
    .filter((segment) => segment.type !== "inserted")
    .map((segment) => segment.text)
    .join("");
}

function rebuildNew(segments: RedlineSegment[]): string {
  return segments
    .filter((segment) => segment.type !== "deleted")
    .map((segment) => segment.text)
    .join("");
}

describe("computeRedline (JI-02)", () => {
  it("marks the changed sentence and keeps the shared one", () => {
    const oldText = "OpenAI charges per token. We assume flat pricing.";
    const newText = "OpenAI charges per token. We now assume tiered pricing.";
    const segments = computeRedline(oldText, newText);

    assert.ok(join(segments, "unchanged").includes("OpenAI charges per token."));
    assert.ok(join(segments, "deleted").includes("flat pricing"));
    assert.ok(join(segments, "inserted").includes("tiered pricing"));
    assert.equal(rebuildOld(segments), oldText);
    assert.equal(rebuildNew(segments), newText);
  });

  it("handles CJK sentence punctuation", () => {
    const segments = computeRedline(
      "竞品X没有移动端。我们据此排期。",
      "竞品X已上线移动端。我们据此排期。"
    );

    assert.ok(join(segments, "deleted").includes("没有移动端"));
    assert.ok(join(segments, "inserted").includes("已上线移动端"));
    assert.ok(join(segments, "unchanged").includes("我们据此排期。"));
  });

  it("reports no change for identical text", () => {
    const segments = computeRedline("Same text here.", "Same text here.");
    assert.ok(segments.every((segment) => segment.type === "unchanged"));
  });

  it("treats an empty original as a pure insertion", () => {
    const segments = computeRedline("", "Brand new truth.");
    assert.equal(segments.length, 1);
    assert.equal(segments[0].type, "inserted");
  });
});
