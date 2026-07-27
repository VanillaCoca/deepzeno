import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideEnqueue,
  detectUpgradeTriggers,
  evaluateGateHealth,
  shouldPromoteToPending,
} from "../../lib/ir/enqueue-core.ts";
import type { IREdge, IRKind, IRNode } from "../../lib/ir/types.ts";

type TargetNode = Pick<IRNode, "id" | "kind" | "status">;

const target = (
  id: string,
  kind: IRKind,
  status: IRNode["status"]
): TargetNode => ({ id, kind, status });

const index = (...nodes: TargetNode[]) =>
  new Map(nodes.map((node) => [node.id, node]));

const edge = (
  relation: IREdge["relation"],
  toNode: string,
  status: IREdge["status"] = "pending"
) => ({ relation, toNode, status });

const decide = (input: Partial<Parameters<typeof decideEnqueue>[0]>) =>
  decideEnqueue({
    kind: "plan",
    sourceLayer: "inline",
    outgoingEdges: [],
    nodesById: new Map(),
    ...input,
  });

describe("decideEnqueue — §3.2 criteria", () => {
  it("enqueues every premise kind: they are the ground others stand on", () => {
    for (const kind of ["principle", "constraint", "hypothesis"] as const) {
      const decision = decide({ kind });
      assert.equal(decision.status, "pending", kind);
      assert.deepEqual(decision.reasons, ["premise"]);
    }
  });

  it("enqueues goals — №1 §5.3 puts candidate goals through the same regime", () => {
    const decision = decide({ kind: "goal" });
    assert.equal(decision.status, "pending");
    assert.deepEqual(decision.reasons, ["goal"]);
  });

  it("enqueues a candidate that reshapes confirmed truth", () => {
    for (const relation of ["supersedes", "resolves", "contradicts"] as const) {
      const decision = decide({
        outgoingEdges: [edge(relation, "t1")],
        nodesById: index(target("t1", "plan", "active")),
      });
      assert.equal(decision.status, "pending", relation);
      assert.ok(decision.reasons.includes("reshapes_truth"), relation);
    }
  });

  it("does not treat a reshape edge into non-active ground as a reshape", () => {
    const decision = decide({
      outgoingEdges: [edge("supersedes", "t1")],
      nodesById: index(target("t1", "plan", "pending")),
    });
    assert.equal(decision.status, "idea");
    assert.deepEqual(decision.reasons, []);
  });

  it("enqueues an answer to an open question even when that question is not yet active", () => {
    const decision = decide({
      outgoingEdges: [edge("resolves", "q1")],
      nodesById: index(target("q1", "open_question", "pending")),
    });
    assert.equal(decision.status, "pending");
    assert.deepEqual(decision.reasons, ["answers_open_question"]);
  });

  it("reports both reasons when an answer also reshapes active truth", () => {
    const decision = decide({
      outgoingEdges: [edge("resolves", "q1")],
      nodesById: index(target("q1", "open_question", "active")),
    });
    assert.deepEqual(decision.reasons, [
      "reshapes_truth",
      "answers_open_question",
    ]);
  });

  it("ignores dismissed edges and dismissed targets", () => {
    assert.equal(
      decide({
        outgoingEdges: [edge("supersedes", "t1", "dismissed")],
        nodesById: index(target("t1", "plan", "active")),
      }).status,
      "idea"
    );

    assert.equal(
      decide({
        outgoingEdges: [edge("supersedes", "t1")],
        nodesById: index(target("t1", "plan", "dismissed")),
      }).status,
      "idea"
    );
  });

  it("ignores edges whose target is not in the index rather than throwing", () => {
    assert.equal(
      decide({ outgoingEdges: [edge("supersedes", "missing")] }).status,
      "idea"
    );
  });

  it("enqueues watchtower and research alerts", () => {
    for (const layer of ["watchtower", "research"] as const) {
      assert.deepEqual(decide({ sourceLayer: layer }).reasons, ["alert"]);
    }
  });

  it("lands a plain additive plan in idea — the whole point of the gate", () => {
    const decision = decide({ kind: "plan", sourceLayer: "sweep" });
    assert.equal(decision.status, "idea");
    assert.deepEqual(decision.reasons, []);
  });

  it("keeps reasons in declaration order so §3.4 can attribute the enqueue rate", () => {
    const decision = decide({
      kind: "hypothesis",
      sourceLayer: "watchtower",
      outgoingEdges: [edge("contradicts", "t1")],
      nodesById: index(target("t1", "principle", "active")),
    });
    assert.deepEqual(decision.reasons, ["premise", "reshapes_truth", "alert"]);
  });
});

describe("detectUpgradeTriggers — §3.2 dynamic upgrade", () => {
  const incoming = (
    fromNode: string,
    relation: IREdge["relation"],
    status: IREdge["status"] = "active"
  ) => ({ fromNode, toNode: "n1", relation, status });

  const detect = (
    input: Partial<Parameters<typeof detectUpgradeTriggers>[0]>
  ) =>
    detectUpgradeTriggers({
      nodeId: "n1",
      status: "idea",
      incomingEdges: [],
      ...input,
    });

  it("upgrades once something depends on it — it became load-bearing", () => {
    for (const relation of ["depends_on", "refines"] as const) {
      assert.deepEqual(detect({ incomingEdges: [incoming("a", relation)] }), [
        "gained_dependent",
      ]);
    }
  });

  it("does not count implies — its direction is reversed", () => {
    assert.deepEqual(detect({ incomingEdges: [incoming("a", "implies")] }), []);
  });

  it("does not count dismissed edges or edges pointing elsewhere", () => {
    assert.deepEqual(
      detect({ incomingEdges: [incoming("a", "depends_on", "dismissed")] }),
      []
    );
    assert.deepEqual(
      detect({
        incomingEdges: [
          { fromNode: "a", toNode: "other", relation: "depends_on", status: "active" },
        ],
      }),
      []
    );
  });

  it("upgrades when the user reasoned from it — into the queue, not past it", () => {
    const triggers = detect({ referencedByUser: true });
    assert.deepEqual(triggers, ["referenced_by_user"]);
    // The whole guarantee of §3.1: this routes to `pending`, never to `active`.
    assert.equal(shouldPromoteToPending(triggers), true);
  });

  it("upgrades on manual promote", () => {
    assert.deepEqual(detect({ manualPromote: true }), ["manual_promote"]);
  });

  it("never re-triggers for nodes that already left idea", () => {
    for (const status of ["pending", "active", "superseded", "dismissed"] as const) {
      assert.deepEqual(
        detect({
          status,
          incomingEdges: [incoming("a", "depends_on")],
          referencedByUser: true,
          manualPromote: true,
        }),
        [],
        status
      );
    }
  });

  it("reports nothing — and promotes nothing — when idle", () => {
    assert.deepEqual(detect({}), []);
    assert.equal(shouldPromoteToPending([]), false);
  });
});

describe("evaluateGateHealth — §3.4", () => {
  it("is quiet on empty periods instead of dividing by zero", () => {
    const health = evaluateGateHealth({
      pendingCreated: 0,
      totalCreated: 0,
      ideaUpgraded: 0,
      ideaTotal: 0,
    });
    assert.equal(health.enqueueRate, 0);
    assert.equal(health.ideaUpgradeRate, 0);
    assert.equal(health.shouldRevertToFullEnqueue, false);
  });

  it("flags a gate that stopped holding anything back", () => {
    const health = evaluateGateHealth({
      pendingCreated: 8,
      totalCreated: 10,
      ideaUpgraded: 0,
      ideaTotal: 10,
    });
    assert.equal(health.enqueueRateBreached, true);
    assert.equal(health.upgradeRateBreached, false);
    assert.equal(health.shouldRevertToFullEnqueue, false);
  });

  it("flags criteria that keep missing load-bearing nodes", () => {
    const health = evaluateGateHealth({
      pendingCreated: 1,
      totalCreated: 10,
      ideaUpgraded: 5,
      ideaTotal: 10,
    });
    assert.equal(health.upgradeRateBreached, true);
    assert.equal(health.shouldRevertToFullEnqueue, false);
  });

  it("calls for the pre-committed revert only when both breach at once", () => {
    const health = evaluateGateHealth({
      pendingCreated: 8,
      totalCreated: 10,
      ideaUpgraded: 5,
      ideaTotal: 10,
    });
    assert.equal(health.shouldRevertToFullEnqueue, true);
  });

  it("treats the ceilings as exclusive — exactly at threshold is not a breach", () => {
    const health = evaluateGateHealth({
      pendingCreated: 5,
      totalCreated: 10,
      ideaUpgraded: 3,
      ideaTotal: 10,
    });
    assert.equal(health.enqueueRateBreached, false);
    assert.equal(health.upgradeRateBreached, false);
  });
});
