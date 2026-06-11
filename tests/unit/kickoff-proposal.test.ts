import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KICKOFF_LIMITS,
  KICKOFF_PENDING_THRESHOLD,
  normalizeKickoffProposal,
  statusForConfidence,
} from "../../lib/kickoff/proposal.ts";

describe("statusForConfidence", () => {
  it("routes high confidence to pending and low to idea", () => {
    assert.equal(statusForConfidence(KICKOFF_PENDING_THRESHOLD), "pending");
    assert.equal(statusForConfidence(0.9), "pending");
    assert.equal(statusForConfidence(0.69), "idea");
    assert.equal(statusForConfidence(null), "idea");
  });
});

describe("normalizeKickoffProposal", () => {
  const node = (overrides = {}) => ({
    kind: "open_question",
    title: "What is the launch deadline?",
    content: null,
    rationale: "Deadline was mentioned but never pinned down.",
    confidence: 0.8,
    ...overrides,
  });

  it("keeps only the allowed kinds", () => {
    const result = normalizeKickoffProposal({
      topics: [
        {
          name: "Launch",
          charter: "When and how do we launch?",
          nodes: [
            node(),
            node({ kind: "plan", title: "Build it" }),
            node({ kind: "rejection", title: "No mobile" }),
            node({ kind: "goal", title: "Ship V1" }),
          ],
        },
      ],
    });
    assert.deepEqual(
      result.topics[0].nodes.map((n) => n.kind),
      ["open_question", "goal"]
    );
  });

  it("caps topics and nodes per topic", () => {
    const manyNodes = Array.from({ length: 10 }, (_, i) =>
      node({ title: `Question ${i}` })
    );
    const manyTopics = Array.from({ length: 9 }, (_, i) => ({
      name: `Topic ${i}`,
      charter: `Charter ${i}`,
      nodes: manyNodes,
    }));
    const result = normalizeKickoffProposal({ topics: manyTopics });
    assert.equal(result.topics.length, KICKOFF_LIMITS.maxTopics);
    assert.equal(
      result.topics[0].nodes.length,
      KICKOFF_LIMITS.maxNodesPerTopic
    );
  });

  it("drops topics with empty names and trims fields", () => {
    const result = normalizeKickoffProposal({
      topics: [
        { name: "   ", charter: "x", nodes: [node()] },
        {
          name: "  Pricing  ",
          charter: "  How do we price?  ",
          nodes: [node()],
        },
      ],
    });
    assert.equal(result.topics.length, 1);
    assert.equal(result.topics[0].name, "Pricing");
    assert.equal(result.topics[0].charter, "How do we price?");
  });

  it("clamps confidence into [0,1]", () => {
    const result = normalizeKickoffProposal({
      topics: [
        {
          name: "T",
          charter: "c",
          nodes: [
            node({ confidence: 7 }),
            node({ title: "b", confidence: -1 }),
          ],
        },
      ],
    });
    assert.equal(result.topics[0].nodes[0].confidence, 1);
    assert.equal(result.topics[0].nodes[1].confidence, 0);
  });
});
