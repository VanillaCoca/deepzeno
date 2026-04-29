export type PendingCandidateCounts = Record<string, number>;

export type WorkspaceProject = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceProjectSummary = WorkspaceProject & {
  topicCount: number;
};

export type WorkspaceTopic = {
  id: string;
  projectId: string;
  label: string;
  isGeneral: boolean;
  archivedAt: string | null;
  position: number;
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
