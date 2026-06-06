import type {
  TopicRelationType,
  WorkspaceTopic,
  WorkspaceTopicRelation,
} from "./workspace/types.ts";

const EFFECTIVE_TOPIC_STATUSES = new Set([
  "exploring",
  "converging",
  "decided",
  "executing",
]);
const PROJECT_ACTIVE_TOPIC_STATUSES = new Set(["decided", "executing"]);
const UPSTREAM_RELATIONS = new Set<TopicRelationType>([
  "depends_on",
  "revisits",
]);

export function isEffectiveJudgmentTopic(topic: WorkspaceTopic) {
  return (
    !topic.isGeneral &&
    !topic.archivedAt &&
    EFFECTIVE_TOPIC_STATUSES.has(topic.status)
  );
}

export function resolveTopicContextIds({
  activeTopicId,
  topics,
  relations,
}: {
  activeTopicId: string;
  topics: WorkspaceTopic[];
  relations: WorkspaceTopicRelation[];
}) {
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const activeTopic = topicById.get(activeTopicId);

  if (!activeTopic || !isEffectiveJudgmentTopic(activeTopic)) {
    return [];
  }

  const selected = new Set<string>([activeTopicId]);
  const queue = [activeTopicId];

  while (queue.length > 0) {
    const currentId = queue.shift();

    if (!currentId) {
      continue;
    }

    for (const relation of relations) {
      if (
        relation.fromTopicId !== currentId ||
        !UPSTREAM_RELATIONS.has(relation.relationType)
      ) {
        continue;
      }

      const upstream = topicById.get(relation.toTopicId);

      if (!(upstream && isEffectiveJudgmentTopic(upstream))) {
        continue;
      }

      if (!selected.has(upstream.id)) {
        selected.add(upstream.id);
        queue.push(upstream.id);
      }
    }
  }

  return [...selected];
}

export function getProjectActiveTopicIds(topics: WorkspaceTopic[]) {
  return topics
    .filter(
      (topic) =>
        !topic.isGeneral &&
        !topic.archivedAt &&
        PROJECT_ACTIVE_TOPIC_STATUSES.has(topic.status)
    )
    .map((topic) => topic.id);
}
