import type { CodeAnchor } from "@/lib/decision-anchors";

export type PendingCandidateCounts = Record<string, number>;

export const topicStatuses = [
  "exploring",
  "converging",
  "decided",
  "executing",
  "superseded",
  "dismissed",
] as const;

export type TopicStatus = (typeof topicStatuses)[number];

export function isTopicStatus(value: string): value is TopicStatus {
  return (topicStatuses as readonly string[]).includes(value);
}

export const topicRelationTypes = [
  "supersedes",
  "revisits",
  "depends_on",
  "contradicts",
] as const;

export type TopicRelationType = (typeof topicRelationTypes)[number];

export function isTopicRelationType(value: string): value is TopicRelationType {
  return (topicRelationTypes as readonly string[]).includes(value);
}

export type WorkspaceProject = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceProjectSummary = WorkspaceProject & {
  primaryTopicId: string | null;
  topicCount: number;
};

export type WorkspaceTopic = {
  id: string;
  projectId: string;
  label: string;
  isGeneral: boolean;
  status: TopicStatus;
  description: string | null;
  defaultModelId: string | null;
  archivedAt: string | null;
  decidedAt: string | null;
  executingAt: string | null;
  supersededAt: string | null;
  dismissedAt: string | null;
  position: number;
  createdAt: string;
};

export type WorkspaceTopicRelation = {
  id: string;
  projectId: string;
  fromTopicId: string;
  toTopicId: string;
  relationType: TopicRelationType;
  createdAt: string;
};

export type WorkspaceConversation = {
  id: string;
  topicId: string;
  projectId: string;
  endedAt: string | null;
  createdAt: string;
};

export type WorkspaceMessageRecord = {
  id: string;
  conversationId: string;
  topicId: string;
  projectId: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  createdAt: string;
};

export type WorkspaceDecision = {
  id: string;
  projectId: string;
  topicId: string;
  title: string;
  content: string;
  rationale: string | null;
  kind: string;
  weight: string;
  status: string;
  sensitivity: string;
  relevantMessageIds: string[] | null;
  codeAnchors: CodeAnchor[] | null;
  createdFromMessageId: string | null;
  confirmedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceEdge = {
  id: string;
  projectId: string;
  topicId: string;
  sourceDecisionId: string;
  targetDecisionId: string;
  type: string;
  createdAt: string;
};

export type WorkspaceCandidateDecision = {
  id: string;
  projectId: string;
  topicId: string;
  conversationId: string | null;
  messageId: string | null;
  proposedTitle: string | null;
  proposedContent: string;
  proposedRationale: string | null;
  proposedKind: string | null;
  proposedWeight: string | null;
  proposedForDecisionId: string | null;
  proposedStatus: string | null;
  proposedIntent: string | null;
  confidence: number | null;
  preSelected: boolean;
  status: string;
  suggestedEdges: Array<{
    type: string;
    targetDecisionId?: string;
  }> | null;
  relevantMessageIds: string[] | null;
  contentHash: string | null;
  resolvedAt: string | null;
  resolvedDecisionId: string | null;
  source: string;
  sourceMetadata: Record<string, unknown> | null;
  externalEvidence: string | null;
  createdAt: string;
};

export type WorkspaceApiKey = {
  id: string;
  userId: string;
  projectId: string;
  keyPrefix: string;
  label: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type WorkspaceTruthSnapshot = {
  decisions: WorkspaceDecision[];
  edges: WorkspaceEdge[];
  pendingCandidates: WorkspaceCandidateDecision[];
};

export type WorkspaceBootstrap = {
  projects: WorkspaceProject[];
  topics: WorkspaceTopic[];
  conversations: WorkspaceConversation[];
  activeProjectId: string;
  activeTopicId: string;
  currentConversationId: string;
  pendingCandidateCounts: PendingCandidateCounts;
  isArchivedTopicReadonly: boolean;
  truthSnapshot: WorkspaceTruthSnapshot | null;
};

export type WorkspaceSelectionParams = {
  projectId?: string | null;
  topicId?: string | null;
  conversationId?: string | null;
};
