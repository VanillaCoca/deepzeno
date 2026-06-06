import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getProjectActiveTopicIds,
  resolveTopicContextIds,
} from "../../lib/topic-lifecycle.ts";
import type {
  TopicStatus,
  WorkspaceTopic,
  WorkspaceTopicRelation,
} from "../../lib/workspace/types.ts";

function topic(id: string, status: TopicStatus): WorkspaceTopic {
  return {
    id,
    projectId: "project-1",
    label: id,
    isGeneral: id === "general",
    status,
    description: null,
    defaultModelId: null,
    archivedAt: null,
    decidedAt: null,
    executingAt: null,
    supersededAt: null,
    dismissedAt: null,
    position: 0,
    createdAt: "2026-05-07T00:00:00.000Z",
  };
}

function relation(
  fromTopicId: string,
  toTopicId: string,
  relationType: WorkspaceTopicRelation["relationType"]
): WorkspaceTopicRelation {
  return {
    id: `${fromTopicId}-${relationType}-${toTopicId}`,
    projectId: "project-1",
    fromTopicId,
    toTopicId,
    relationType,
    createdAt: "2026-05-07T00:00:00.000Z",
  };
}

describe("topic lifecycle context helpers", () => {
  it("starts a judgment context from the current topic and valid upstream relations", () => {
    const topics = [
      topic("current", "exploring"),
      topic("dependency", "decided"),
      topic("revisited", "executing"),
      topic("superseded", "superseded"),
      topic("dismissed", "dismissed"),
      topic("general", "exploring"),
    ];
    const relations = [
      relation("current", "dependency", "depends_on"),
      relation("dependency", "revisited", "revisits"),
      relation("current", "superseded", "depends_on"),
      relation("current", "dismissed", "revisits"),
      relation("current", "general", "depends_on"),
    ];

    assert.deepEqual(
      resolveTopicContextIds({
        activeTopicId: "current",
        topics,
        relations,
      }),
      ["current", "dependency", "revisited"]
    );
  });

  it("excludes general, archived, superseded, and dismissed topics from project active context", () => {
    const archived = topic("archived", "decided");
    archived.archivedAt = "2026-05-07T00:00:00.000Z";

    assert.deepEqual(
      getProjectActiveTopicIds([
        topic("exploring", "exploring"),
        topic("decided", "decided"),
        topic("executing", "executing"),
        topic("superseded", "superseded"),
        topic("dismissed", "dismissed"),
        topic("general", "decided"),
        archived,
      ]),
      ["decided", "executing"]
    );
  });
});
