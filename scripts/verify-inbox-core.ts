/**
 * Runnable verification for the Judgment Inbox ranking core.
 *
 *   npx tsx scripts/verify-inbox-core.ts
 *
 * The repo's `pnpm test` is Playwright e2e only, so the pure ranking logic
 * (blast radius / tiering / ordering — PRD JI-08 and the D1 §3 ordering rules)
 * is verified here against plain fixtures, with no DB. Exits non-zero on any
 * failed assertion.
 */
import assert from "node:assert/strict";
import {
  buildInboxItems,
  InboxTier,
  type InboxItem,
} from "@/lib/ir/inbox-core";
import type { IREdge, IRNode, IRRelation, IRStatus } from "@/lib/ir/types";

function makeNode(
  id: string,
  status: IRStatus,
  over: Partial<IRNode> = {}
): IRNode {
  return {
    id,
    projectId: "p",
    topicId: "t",
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
    createdAt: "2026-07-20T00:00:00Z",
    promotedToPendingAt: null,
    confirmedAt: null,
    supersededAt: null,
    supersededBy: null,
    createdBy: "ai",
    confirmedBy: null,
    ...over,
  };
}

function makeEdge(
  fromNode: string,
  toNode: string,
  relation: IRRelation,
  status: IREdge["status"] = "active"
): IREdge {
  return {
    id: `${fromNode}->${toNode}:${relation}`,
    projectId: "p",
    fromNode,
    toNode,
    relation,
    label: null,
    status,
    isAnchorHint: false,
    createdAt: "2026-07-20T00:00:00Z",
    confirmedAt: null,
  };
}

function only(items: InboxItem[]): InboxItem {
  assert.equal(items.length, 1, "expected exactly one item");
  return items[0];
}

// JI-08 — a supersede candidate inherits its target's dependents.
{
  const active = ["C1", "D1", "D2", "D3"].map((id) => makeNode(id, "active"));
  const edges = [
    makeEdge("D1", "C1", "depends_on"),
    makeEdge("D2", "C1", "depends_on"),
    makeEdge("D3", "C1", "depends_on"),
    makeEdge("C1b", "C1", "supersedes", "pending"),
  ];
  const item = only(
    buildInboxItems({
      pendingNodes: [makeNode("C1b", "pending")],
      activeNodes: active,
      edges,
    })
  );
  assert.equal(item.blastRadius, 3);
  assert.equal(item.isSupersede, true);
  assert.equal(item.reshapeTargetId, "C1");
  assert.equal(item.tier, InboxTier.reshape);
  assert.equal(item.topDownstream.length, 3);
  console.log("JI-08 supersede inherits target radius: OK");
}

// JI-08 — a leaf create candidate has radius 0 and is additive.
{
  const item = only(
    buildInboxItems({
      pendingNodes: [makeNode("Gnew", "pending")],
      activeNodes: [makeNode("C1", "active")],
      edges: [],
    })
  );
  assert.equal(item.blastRadius, 0);
  assert.equal(item.tier, InboxTier.additive);
  assert.equal(item.reshapeTargetId, null);
  console.log("JI-08 leaf create radius 0: OK");
}

// Depth cap D = 3 — a chain longer than three hops is truncated.
{
  const active = ["A0", "A1", "A2", "A3", "A4"].map((id) =>
    makeNode(id, "active")
  );
  const edges = [
    makeEdge("A1", "A0", "depends_on"),
    makeEdge("A2", "A1", "depends_on"),
    makeEdge("A3", "A2", "depends_on"),
    makeEdge("A4", "A3", "depends_on"),
    makeEdge("A0b", "A0", "supersedes", "pending"),
  ];
  const item = only(
    buildInboxItems({
      pendingNodes: [makeNode("A0b", "pending")],
      activeNodes: active,
      edges,
    })
  );
  assert.equal(item.blastRadius, 3, "A4 is four hops out and must be excluded");
  console.log("depth cap D=3: OK");
}

// Diamond dependency — a node reachable by two paths is counted once.
{
  const active = ["R", "X", "Y", "Z"].map((id) => makeNode(id, "active"));
  const edges = [
    makeEdge("X", "R", "depends_on"),
    makeEdge("Y", "R", "depends_on"),
    makeEdge("Z", "X", "depends_on"),
    makeEdge("Z", "Y", "depends_on"),
    makeEdge("Rb", "R", "supersedes", "pending"),
  ];
  const item = only(
    buildInboxItems({
      pendingNodes: [makeNode("Rb", "pending")],
      activeNodes: active,
      edges,
    })
  );
  assert.equal(item.blastRadius, 3, "Z must be deduped");
  console.log("diamond dedup: OK");
}

// Ordering — a reshape ruling outranks a higher-radius additive candidate.
{
  const active = ["T", "x1", "Big", "d1", "d2", "d3", "d4", "d5"].map((id) =>
    makeNode(id, "active")
  );
  const edges = [
    makeEdge("x1", "T", "depends_on"),
    makeEdge("d1", "Big", "depends_on"),
    makeEdge("d2", "Big", "depends_on"),
    makeEdge("d3", "Big", "depends_on"),
    makeEdge("d4", "Big", "depends_on"),
    makeEdge("d5", "Big", "depends_on"),
    makeEdge("Small", "T", "supersedes", "pending"),
  ];
  const items = buildInboxItems({
    pendingNodes: [
      makeNode("Big", "pending", { createdAt: "2026-07-19T00:00:00Z" }),
      makeNode("Small", "pending"),
    ],
    activeNodes: active,
    edges,
  });
  assert.equal(items[0].node.id, "Small", "reshape tier ranks first");
  assert.equal(items[1].node.id, "Big");
  console.log("tier beats radius ordering: OK");
}

// `implies` is excluded from blast radius in v0.1 (direction is reversed).
{
  const item = only(
    buildInboxItems({
      pendingNodes: [makeNode("Hb", "pending")],
      activeNodes: [makeNode("H", "active"), makeNode("B", "active")],
      edges: [
        makeEdge("B", "H", "implies"),
        makeEdge("Hb", "H", "supersedes", "pending"),
      ],
    })
  );
  assert.equal(item.blastRadius, 0, "implies must not count in v0.1");
  console.log("implies excluded: OK");
}

// Dismissed edges and non-active dependents are both ignored.
{
  const items = buildInboxItems({
    pendingNodes: [makeNode("Cb", "pending"), makeNode("p", "pending")],
    activeNodes: [makeNode("C", "active")],
    edges: [
      makeEdge("d", "C", "depends_on", "dismissed"),
      makeEdge("p", "C", "depends_on"),
      makeEdge("Cb", "C", "supersedes", "pending"),
    ],
  });
  const cb = items.find((item) => item.node.id === "Cb");
  assert.ok(cb);
  assert.equal(cb.blastRadius, 0);
  console.log("dismissed + non-active ignored: OK");
}

console.log("\nALL INBOX-CORE CHECKS PASSED");
