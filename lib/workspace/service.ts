import "server-only";

import { ChatbotError } from "@/lib/errors";
import {
  archiveTopicById,
  createConversation,
  createProjectForUser,
  createTopicForProject,
  endConversation,
  getConversationByIdForUser,
  getDecisionByIdForUser,
  getProjectByIdForUser,
  getTopicByIdForUser,
  insertDecision,
  insertDecisionLog,
  insertEdge,
  listConversationsByTopicId,
  listDecisionsByTopicId,
  listEdgesByTopicId,
  listPendingCandidatesByTopicId,
  listProjectsByUserId,
  listTopicsByProjectId,
  listWorkspaceMessagesByIds,
  updateDecisionStatus,
} from "./queries";
import type {
  WorkspaceBootstrap,
  WorkspaceConversation,
  WorkspaceMessageRecord,
  WorkspaceSelectionParams,
  WorkspaceTopic,
  WorkspaceTruthSnapshot,
} from "./types";

const DEFAULT_PROJECT_NAME = "My Project";
const GENERAL_TOPIC_LABEL = "General";

async function provisionProjectBundle({
  userId,
  userEmail,
  name,
}: {
  userId: string;
  userEmail?: string | null;
  name: string;
}) {
  const project = await createProjectForUser({ userId, userEmail, name });
  const generalTopic = await createTopicForProject({
    projectId: project.id,
    label: GENERAL_TOPIC_LABEL,
    isGeneral: true,
  });
  const firstConversation = await createConversation({
    topicId: generalTopic.id,
    projectId: project.id,
  });

  return {
    project,
    generalTopic,
    firstConversation,
  };
}

function pickActiveTopicId({
  topics,
  requestedTopicId,
}: {
  topics: Awaited<ReturnType<typeof listTopicsByProjectId>>;
  requestedTopicId?: string | null;
}) {
  if (
    requestedTopicId &&
    topics.some((topic: WorkspaceTopic) => topic.id === requestedTopicId)
  ) {
    return requestedTopicId;
  }

  const firstActiveTopic = topics.find(
    (topic: WorkspaceTopic) => !topic.archivedAt
  );
  return firstActiveTopic?.id ?? topics[0]?.id ?? null;
}

function pickConversationId({
  conversations,
  requestedConversationId,
}: {
  conversations: Awaited<ReturnType<typeof listConversationsByTopicId>>;
  requestedConversationId?: string | null;
}) {
  if (
    requestedConversationId &&
    conversations.some(
      (conversation: WorkspaceConversation) =>
        conversation.id === requestedConversationId
    )
  ) {
    return requestedConversationId;
  }

  return conversations.at(-1)?.id ?? null;
}

export async function bootstrapWorkspace({
  userId,
  userEmail,
  selection,
}: {
  userId: string;
  userEmail?: string | null;
  selection?: WorkspaceSelectionParams;
}): Promise<WorkspaceBootstrap> {
  let projects = await listProjectsByUserId(userId);

  if (projects.length === 0) {
    await provisionProjectBundle({
      userId,
      userEmail,
      name: DEFAULT_PROJECT_NAME,
    });
    projects = await listProjectsByUserId(userId);
  }

  const selectedConversation = selection?.conversationId
    ? await getConversationByIdForUser(selection.conversationId, userId)
    : null;

  const activeProject =
    (selectedConversation
      ? await getProjectByIdForUser(selectedConversation.projectId, userId)
      : null) ??
    (selection?.projectId
      ? (projects.find(
          (project: (typeof projects)[number]) =>
            project.id === selection.projectId
        ) ?? null)
      : null) ??
    projects[0];

  if (!activeProject) {
    throw new ChatbotError(
      "bad_request:database",
      "No active project available"
    );
  }

  let topics = await listTopicsByProjectId(activeProject.id);

  if (topics.length === 0) {
    const topic = await createTopicForProject({
      projectId: activeProject.id,
      label: GENERAL_TOPIC_LABEL,
      isGeneral: true,
    });
    await createConversation({
      topicId: topic.id,
      projectId: activeProject.id,
    });
    topics = await listTopicsByProjectId(activeProject.id);
  }

  const activeTopicId = pickActiveTopicId({
    topics,
    requestedTopicId: selectedConversation?.topicId ?? selection?.topicId,
  });

  if (!activeTopicId) {
    throw new ChatbotError("bad_request:database", "No active topic available");
  }

  const activeTopic = topics.find(
    (topic: WorkspaceTopic) => topic.id === activeTopicId
  );

  if (!activeTopic) {
    throw new ChatbotError("bad_request:database", "Active topic not found");
  }

  let conversations = await listConversationsByTopicId(activeTopic.id);

  if (conversations.length === 0) {
    await createConversation({
      topicId: activeTopic.id,
      projectId: activeProject.id,
    });
    conversations = await listConversationsByTopicId(activeTopic.id);
  }

  const currentConversationId = pickConversationId({
    conversations,
    requestedConversationId:
      selectedConversation?.id ?? selection?.conversationId,
  });

  if (!currentConversationId) {
    throw new ChatbotError(
      "bad_request:database",
      "No active conversation available"
    );
  }

  return {
    projects,
    topics,
    conversations,
    activeProjectId: activeProject.id,
    activeTopicId: activeTopic.id,
    currentConversationId,
    pendingCandidateCounts: {},
    isArchivedTopicReadonly: Boolean(activeTopic.archivedAt),
    truthSnapshot: null,
  };
}

export function createProjectWithDefaults({
  userId,
  userEmail,
  name,
}: {
  userId: string;
  userEmail?: string | null;
  name: string;
}) {
  return provisionProjectBundle({ userId, userEmail, name });
}

export async function createProjectFromExtraction({
  userId,
  userEmail,
  projectName,
  topics,
}: {
  userId: string;
  userEmail?: string | null;
  projectName: string;
  topics: Array<{
    name: string;
    decisions: Array<{
      type: string;
      content: string;
    }>;
  }>;
}) {
  const sanitizedTopics = topics
    .map((topic) => ({
      name: topic.name.trim(),
      decisions: topic.decisions.filter(
        (decision) => decision.content.trim().length > 0
      ),
    }))
    .filter((topic) => topic.decisions.length > 0);

  if (sanitizedTopics.length === 0) {
    return provisionProjectBundle({
      userId,
      userEmail,
      name: projectName,
    });
  }

  const project = await createProjectForUser({
    userId,
    userEmail,
    name: projectName,
  });

  let activeTopic: WorkspaceTopic | null = null;
  let firstConversation: WorkspaceConversation | null = null;

  for (const [topicIndex, topic] of sanitizedTopics.entries()) {
    const createdTopic = await createTopicForProject({
      projectId: project.id,
      label: topic.name || `Topic ${topicIndex + 1}`,
      position: topicIndex,
    });

    if (!activeTopic) {
      activeTopic = createdTopic;
      firstConversation = await createConversation({
        topicId: createdTopic.id,
        projectId: project.id,
      });
    }

    for (const decision of topic.decisions) {
      const content = decision.content.trim();

      await insertDecision({
        projectId: project.id,
        topicId: createdTopic.id,
        title: content,
        content,
        kind: decision.type,
        status: "active",
        weight: "normal",
        confirmedByUserId: userId,
      });
    }
  }

  if (!activeTopic || !firstConversation) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create extracted workspace"
    );
  }

  return {
    project,
    activeTopic,
    firstConversation,
  };
}

export async function createTopicWithConversation({
  userId,
  projectId,
  label,
}: {
  userId: string;
  projectId: string;
  label: string;
}) {
  const project = await getProjectByIdForUser(projectId, userId);

  if (!project) {
    throw new ChatbotError("forbidden:chat", "Project not found");
  }

  const topic = await createTopicForProject({
    projectId,
    label,
  });

  const conversation = await createConversation({
    topicId: topic.id,
    projectId,
  });

  return {
    topic,
    conversation,
  };
}

export async function archiveTopicForUser({
  userId,
  topicId,
}: {
  userId: string;
  topicId: string;
}) {
  const topic = await getTopicByIdForUser(topicId, userId);

  if (!topic) {
    throw new ChatbotError("forbidden:chat", "Topic not found");
  }

  if (topic.isGeneral) {
    throw new ChatbotError(
      "bad_request:api",
      "General topic cannot be archived"
    );
  }

  return archiveTopicById(topicId);
}

export async function clearConversationSegment({
  userId,
  topicId,
  conversationId,
}: {
  userId: string;
  topicId: string;
  conversationId?: string | null;
}) {
  const topic = await getTopicByIdForUser(topicId, userId);

  if (!topic) {
    throw new ChatbotError("forbidden:chat", "Topic not found");
  }

  const conversations = await listConversationsByTopicId(topicId);
  const current =
    conversations.find(
      (conversation: WorkspaceConversation) =>
        conversation.id === conversationId
    ) ?? conversations.at(-1);

  if (current && !current.endedAt) {
    await endConversation(current.id);
  }

  return createConversation({
    topicId,
    projectId: topic.projectId,
  });
}

export async function ensureWorkspaceSelectionForUser({
  userId,
  projectId,
  topicId,
  conversationId,
}: {
  userId: string;
  projectId: string;
  topicId: string;
  conversationId: string;
}) {
  const [project, topic, existingConversation] = await Promise.all([
    getProjectByIdForUser(projectId, userId),
    getTopicByIdForUser(topicId, userId),
    getConversationByIdForUser(conversationId, userId),
  ]);

  if (!project || !topic) {
    throw new ChatbotError("forbidden:chat", "Workspace selection is invalid");
  }

  if (topic.projectId !== project.id) {
    throw new ChatbotError(
      "bad_request:api",
      "Topic does not belong to project"
    );
  }

  const conversation =
    existingConversation && existingConversation.topicId === topic.id
      ? existingConversation
      : await createConversation({
          id: conversationId,
          topicId: topic.id,
          projectId: project.id,
        });

  return {
    project,
    topic,
    conversation,
  };
}

export async function getTopicTruthSnapshot({
  userId,
  topicId,
}: {
  userId: string;
  topicId: string;
}): Promise<WorkspaceTruthSnapshot> {
  const topic = await getTopicByIdForUser(topicId, userId);

  if (!topic) {
    throw new ChatbotError("forbidden:chat", "Topic not found");
  }

  const [decisions, edges, pendingCandidates] = await Promise.all([
    listDecisionsByTopicId(topicId),
    listEdgesByTopicId(topicId),
    listPendingCandidatesByTopicId(topicId),
  ]);

  return {
    decisions,
    edges,
    pendingCandidates,
  };
}

export async function getWorkspaceMessagesForSandbox({
  userId,
  messageIds,
}: {
  userId: string;
  messageIds: string[];
}) {
  const records = await listWorkspaceMessagesByIds(messageIds);

  const allowed = await Promise.all(
    records.map(async (record: WorkspaceMessageRecord) => {
      const topic = await getTopicByIdForUser(record.topicId, userId);
      return topic ? record : null;
    })
  );

  return allowed.filter((record): record is (typeof records)[number] =>
    Boolean(record)
  );
}

export async function resolveOpenQuestionForUser({
  userId,
  decisionId,
  kind,
  title,
  content,
  rationale,
}: {
  userId: string;
  decisionId: string;
  kind: "plan" | "constraint" | "principle" | "hypothesis" | "goal";
  title: string;
  content: string;
  rationale?: string | null;
}) {
  const sourceDecision = await getDecisionByIdForUser(decisionId, userId);

  if (!sourceDecision) {
    throw new ChatbotError("forbidden:chat", "Decision not found");
  }

  if (
    sourceDecision.kind !== "open_question" ||
    sourceDecision.status !== "active"
  ) {
    throw new ChatbotError(
      "bad_request:api",
      "Only active open questions can be resolved"
    );
  }

  const createdDecision = await insertDecision({
    projectId: sourceDecision.projectId,
    topicId: sourceDecision.topicId,
    title,
    content,
    rationale: rationale ?? null,
    kind,
    weight: sourceDecision.weight,
    status: "active",
    relevantMessageIds: sourceDecision.relevantMessageIds,
    createdFromMessageId: sourceDecision.createdFromMessageId,
    confirmedByUserId: userId,
  });

  await insertEdge({
    projectId: sourceDecision.projectId,
    topicId: sourceDecision.topicId,
    sourceDecisionId: createdDecision.id,
    targetDecisionId: sourceDecision.id,
    type: "resolved_by",
  });

  await updateDecisionStatus({
    decisionId: sourceDecision.id,
    status: "superseded",
  });

  await insertDecisionLog({
    decisionId: sourceDecision.id,
    action: "open_question_resolved",
    actorType: "user",
    metadata: {
      resolvedByDecisionId: createdDecision.id,
    },
  });
  await insertDecisionLog({
    decisionId: createdDecision.id,
    action: "created",
    actorType: "user",
    metadata: {
      resolvedOpenQuestionId: sourceDecision.id,
    },
  });

  const snapshot = await getTopicTruthSnapshot({
    userId,
    topicId: sourceDecision.topicId,
  });

  return {
    decision: createdDecision,
    snapshot,
  };
}
