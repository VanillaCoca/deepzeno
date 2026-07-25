import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ContextIREdge,
  type ContextIRNode,
  serializeIRWithinBudget,
} from "../../lib/context/truth-budget.ts";

let seq = 0;

function node(kind: string, topicId: string | null, title: string) {
  seq += 1;
  return {
    id: `n${seq}`,
    projectId: "p",
    topicId,
    kind,
    subtype: null,
    title,
    content: null,
    rationale: null,
    createdAt: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
  } satisfies ContextIRNode;
}

function edge(fromNode: string, toNode: string, relation: string) {
  seq += 1;
  return {
    id: `e${seq}`,
    projectId: "p",
    fromNode,
    toNode,
    relation,
    status: "active",
  } satisfies ContextIREdge;
}

// Budget that fits exactly one rendered line of the given node.
function budgetForOneLine(line: string) {
  return Math.floor((line.length + 1) / 0.8);
}

describe("serializeIRWithinBudget", () => {
  it("emits no omission notice when everything fits", () => {
    const out = serializeIRWithinBudget({
      nodes: [node("constraint", "t1", "A"), node("plan", "t1", "B")],
      edges: [],
      budgetChars: 18_000,
      activeTopicId: "t1",
    });

    assert.ok(out.includes("A"));
    assert.ok(out.includes("B"));
    assert.ok(!out.includes("<ir_omitted>"));
  });

  it("keeps the constraint and declares the dropped plan", () => {
    const constraint = node(
      "constraint",
      "t1",
      "never own the execution environment"
    );
    const plan = node("plan", "t1", "launch domestic first");

    const out = serializeIRWithinBudget({
      nodes: [plan, constraint],
      edges: [],
      budgetChars: budgetForOneLine(
        `- [${constraint.id}] (constraint, topic=t1) ${constraint.title}`
      ),
      activeTopicId: "t1",
    });

    assert.ok(out.includes(constraint.title));
    assert.ok(!out.includes(plan.title));
    assert.ok(out.includes("<ir_omitted>"));
    assert.ok(out.includes("plan×1"));
  });

  it("never truncates a node mid-line", () => {
    const nodes = Array.from({ length: 60 }, (_unused, index) =>
      node("plan", "t1", `plan number ${index} with a reasonably long title`)
    );

    const out = serializeIRWithinBudget({
      nodes,
      edges: [],
      budgetChars: 900,
      activeTopicId: "t1",
    });

    for (const line of out.split("\n")) {
      if (line.startsWith("- [")) {
        assert.match(
          line,
          /^- \[n\d+\] \(plan, topic=t1\) plan number \d+ with a reasonably long title$/
        );
      }
    }
    assert.ok(out.includes("<ir_omitted>"));
  });

  it("prefers the active topic over a sibling topic at equal kind", () => {
    const near = node("hypothesis", "t1", "near hypothesis");
    const far = node("hypothesis", "t2", "far hypothesis");

    const out = serializeIRWithinBudget({
      nodes: [far, near],
      edges: [],
      budgetChars: budgetForOneLine(
        `- [${near.id}] (hypothesis, topic=t1) ${near.title}`
      ),
      activeTopicId: "t1",
    });

    assert.ok(out.includes("near hypothesis"));
    assert.ok(!out.includes("far hypothesis"));
  });

  it("separates peers by structural load", () => {
    const heavy = node("plan", "t1", "load bearing plan aaaaaa");
    const light = node("plan", "t1", "leaf plan bbbbbbbbbbbb");
    const dependents = Array.from({ length: 3 }, () =>
      node("plan", "t9", "dependent")
    );

    const out = serializeIRWithinBudget({
      nodes: [light, heavy],
      edges: dependents.map((dependent) =>
        edge(dependent.id, heavy.id, "depends_on")
      ),
      budgetChars: budgetForOneLine(
        `- [${heavy.id}] (plan, topic=t1) ${heavy.title}`
      ),
      activeTopicId: "t1",
    });

    assert.ok(out.includes("load bearing plan"));
    assert.ok(!out.includes("leaf plan"));
  });

  it("does not let recency promote a plan over an older constraint", () => {
    const oldConstraint = node("constraint", "t1", "old constraint");
    node("plan", "t1", "brand new plan");

    const out = serializeIRWithinBudget({
      nodes: [oldConstraint, node("plan", "t1", "brand new plan")],
      edges: [],
      budgetChars: budgetForOneLine(
        `- [${oldConstraint.id}] (constraint, topic=t1) old constraint`
      ),
      activeTopicId: "t1",
    });

    assert.ok(out.includes("old constraint"));
    assert.ok(!out.includes("brand new plan"));
  });

  it("never emits an edge pointing at a dropped node", () => {
    const kept = node("constraint", "t1", "kept");
    const dropped = node(
      "plan",
      "t1",
      "dropped plan with a long title to blow the budget"
    );

    const out = serializeIRWithinBudget({
      nodes: [kept, dropped],
      edges: [edge(dropped.id, kept.id, "depends_on")],
      budgetChars: budgetForOneLine(
        `- [${kept.id}] (constraint, topic=t1) kept`
      ),
      activeTopicId: "t1",
    });

    assert.ok(!out.includes(dropped.id));
  });

  it("keeps the payload inside the budget at scale", () => {
    const nodes = Array.from({ length: 500 }, (_unused, index) =>
      node(
        index % 2 === 0 ? "plan" : "constraint",
        "t1",
        `node ${index} ${"x".repeat(80)}`
      )
    );
    const budget = 18_000;

    const out = serializeIRWithinBudget({
      nodes,
      edges: [],
      budgetChars: budget,
      activeTopicId: "t1",
    });
    const notice = out.slice(out.indexOf("<ir_omitted>"));

    assert.ok(out.length - notice.length <= budget);
    assert.ok(out.includes("constraint×"));
  });
});
