import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTruthGraphModel,
  getEdgesWithinNodeSet,
  getUpstreamNodeIds,
} from "../../components/ir/truth-graph/data.ts";
import type { IREdge, IRNode, IRRelation } from "../../lib/ir/types.ts";

function node(id: string, topicId = "topic-a"): IRNode {
  return {
    id,
    projectId: "project-1",
    topicId,
    kind: "plan",
    subtype: "decision",
    status: "active",
    title: id,
    content: id,
    rationale: null,
    sensitivity: "normal",
    sourceChatId: null,
    sourceTurnId: null,
    sourceTextSpan: null,
    sourceLayer: "manual",
    importSessionId: null,
    reactivationAnchorId: null,
    extractionConfidence: null,
    createdAt: `2026-06-03T00:00:0${id.length}.000Z`,
    promotedToPendingAt: null,
    confirmedAt: "2026-06-03T00:00:00.000Z",
    supersededAt: null,
    supersededBy: null,
    createdBy: "user",
    confirmedBy: "user-1",
  };
}

function edge(
  id: string,
  fromNode: string,
  toNode: string,
  relation: IRRelation
): IREdge {
  return {
    id,
    projectId: "project-1",
    fromNode,
    toNode,
    relation,
    status: "active",
    isAnchorHint: false,
    createdAt: "2026-06-03T00:00:00.000Z",
    confirmedAt: "2026-06-03T00:00:00.000Z",
  };
}

describe("truth graph data", () => {
  it("converts IR relation semantics into upstream flow edges", () => {
    const model = buildTruthGraphModel({
      nodes: [node("A"), node("B"), node("C")],
      edges: [
        edge("e1", "B", "A", "depends_on"),
        edge("e2", "B", "C", "implies"),
      ],
      topics: [{ id: "topic-a", label: "Judgment A" }],
    });

    assert.deepEqual(
      model.flowEdges.map((item) => [item.parentId, item.childId]),
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );
  });

  it("extracts only the selected node upstream chain", () => {
    const model = buildTruthGraphModel({
      nodes: [node("A"), node("B"), node("C"), node("D", "topic-b")],
      edges: [
        edge("e1", "B", "A", "depends_on"),
        edge("e2", "C", "B", "depends_on"),
        edge("e3", "D", "A", "depends_on"),
      ],
      topics: [
        { id: "topic-a", label: "Judgment A" },
        { id: "topic-b", label: "Judgment B" },
      ],
    });

    const upstream = getUpstreamNodeIds(model, "C");

    assert.deepEqual([...upstream].sort(), ["A", "B", "C"]);
    assert.deepEqual(
      getEdgesWithinNodeSet(model, upstream).map((item) => item.id),
      ["e1", "e2"]
    );
  });
});
