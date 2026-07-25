import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInboxItems,
  InboxTier,
} from "../../lib/ir/inbox-core.ts";
import type {
  IREdge,
  IRNode,
  IRRelation,
  IRStatus,
} from "../../lib/ir/types.ts";

function node(id: string, status: IRStatus, over: Partial<IRNode> = {}): IRNode {
  return {
    id,
    projectId: "project-1",
    topicId: "topic-a",
    parentId: null,
    kind: "hypothesis",
    subtype: null,
    status,
    title: id,
    content: null,
    rationale: null,
    sensitivity: "normal",
    sourceChatId: null,
    sourceTurnId: null,
    sourceTextSpan: null,
    sourceLayer: "manual",
    importSessionId: null,
    reactivationAnchorId: null,
    extractionConfidence: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    promotedToPendingAt: null,
    confirmedAt: null,
    supersededAt: null,
    supersededBy: null,
    createdBy: "ai",
    confirmedBy: null,
    ...over,
  };
}

function edge(
  fromNode: string,
  toNode: string,
  relation: IRRelation,
  status: IREdge["status"] = "active"
): IREdge {
  return {
    id: `${fromNode}->${toNode}:${relation}`,
    projectId: "project-1",
    fromNode,
    toNode,
    relation,
    label: null,
    status,
    isAnchorHint: false,
    createdAt: "2026-07-20T00:00:00.000Z",
    confirmedAt: null,
  };
}

describe("buildInboxItems — blast radius (JI-08)", () => {
  it("a supersede candidate inherits its target's dependents", () => {
    const active = ["C1", "D1", "D2", "D3"].map((id) => node(id, "active"));
    const items = buildInboxItems({
      pendingNodes: [node("C1b", "pending")],
      activeNodes: active,
      edges: [
        edge("D1", "C1", "depends_on"),
        edge("D2", "C1", "depends_on"),
        edge("D3", "C1", "depends_on"),
        edge("C1b", "C1", "supersedes", "pending"),
      ],
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].blastRadius, 3);
    assert.equal(items[0].isSupersede, true);
    assert.equal(items[0].reshapeTargetId, "C1");
    assert.equal(items[0].tier, InboxTier.reshape);
    assert.equal(items[0].topDownstream.length, 3);
  });

  it("a leaf create candidate has radius 0 and the additive tier", () => {
    const items = buildInboxItems({
      pendingNodes: [node("Gnew", "pending")],
      activeNodes: [node("C1", "active")],
      edges: [],
    });

    assert.equal(items[0].blastRadius, 0);
    assert.equal(items[0].tier, InboxTier.additive);
    assert.equal(items[0].reshapeTargetId, null);
  });

  it("caps traversal at depth 3", () => {
    const active = ["A0", "A1", "A2", "A3", "A4"].map((id) =>
      node(id, "active")
    );
    const items = buildInboxItems({
      pendingNodes: [node("A0b", "pending")],
      activeNodes: active,
      edges: [
        edge("A1", "A0", "depends_on"),
        edge("A2", "A1", "depends_on"),
        edge("A3", "A2", "depends_on"),
        edge("A4", "A3", "depends_on"),
        edge("A0b", "A0", "supersedes", "pending"),
      ],
    });

    // A1/A2/A3 are within three hops; A4 is the fourth and is excluded.
    assert.equal(items[0].blastRadius, 3);
  });

  it("dedups a node reachable by two paths (diamond)", () => {
    const active = ["R", "X", "Y", "Z"].map((id) => node(id, "active"));
    const items = buildInboxItems({
      pendingNodes: [node("Rb", "pending")],
      activeNodes: active,
      edges: [
        edge("X", "R", "depends_on"),
        edge("Y", "R", "depends_on"),
        edge("Z", "X", "depends_on"),
        edge("Z", "Y", "depends_on"),
        edge("Rb", "R", "supersedes", "pending"),
      ],
    });

    assert.equal(items[0].blastRadius, 3);
  });

  it("excludes `implies` (reversed direction) and ignores dismissed / non-active dependents", () => {
    const impliesItems = buildInboxItems({
      pendingNodes: [node("Hb", "pending")],
      activeNodes: [node("H", "active"), node("B", "active")],
      edges: [
        edge("B", "H", "implies"),
        edge("Hb", "H", "supersedes", "pending"),
      ],
    });
    assert.equal(impliesItems[0].blastRadius, 0);

    const dismissedItems = buildInboxItems({
      // 'p' is pending (not active) so it must not count as a dependent.
      pendingNodes: [node("Cb", "pending"), node("p", "pending")],
      activeNodes: [node("C", "active")],
      edges: [
        edge("d", "C", "depends_on", "dismissed"),
        edge("p", "C", "depends_on"),
        edge("Cb", "C", "supersedes", "pending"),
      ],
    });
    const cb = dismissedItems.find((item) => item.node.id === "Cb");
    assert.ok(cb);
    assert.equal(cb.blastRadius, 0);
  });
});

describe("buildInboxItems — ordering (D1 §3)", () => {
  it("ranks a reshape ruling above a higher-radius additive candidate", () => {
    const active = ["T", "x1", "Big", "d1", "d2", "d3", "d4", "d5"].map((id) =>
      node(id, "active")
    );
    const items = buildInboxItems({
      pendingNodes: [
        node("Big", "pending", { createdAt: "2026-07-19T00:00:00.000Z" }),
        node("Small", "pending"),
      ],
      activeNodes: active,
      edges: [
        edge("x1", "T", "depends_on"),
        edge("d1", "Big", "depends_on"),
        edge("d2", "Big", "depends_on"),
        edge("d3", "Big", "depends_on"),
        edge("d4", "Big", "depends_on"),
        edge("d5", "Big", "depends_on"),
        edge("Small", "T", "supersedes", "pending"),
      ],
    });

    assert.equal(items[0].node.id, "Small");
    assert.equal(items[0].tier, InboxTier.reshape);
    assert.equal(items[1].node.id, "Big");
  });

  it("breaks ties by blast radius desc, then oldest first", () => {
    const active = ["a", "b"].map((id) => node(id, "active"));
    const items = buildInboxItems({
      pendingNodes: [
        node("new-leaf", "pending", { createdAt: "2026-07-22T00:00:00.000Z" }),
        node("old-leaf", "pending", { createdAt: "2026-07-18T00:00:00.000Z" }),
      ],
      activeNodes: active,
      edges: [],
    });

    // Same tier + radius 0 → the older pending sorts first (don't let it rot).
    assert.equal(items[0].node.id, "old-leaf");
    assert.equal(items[1].node.id, "new-leaf");
  });
});
