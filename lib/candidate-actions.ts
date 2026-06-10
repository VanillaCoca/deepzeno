import "server-only";

import { normalizeCodeAnchors } from "@/lib/decision-anchors";
import { ChatbotError } from "@/lib/errors";
import {
  deleteEdgeById,
  getTopicByIdForUser,
  insertDecision,
  insertDecisionLog,
  insertEdge,
  listPendingCandidatesByTopicId,
  updateCandidateResolution,
  updateDecision,
  updateDecisionStatus,
} from "@/lib/workspace/queries";
import type { WorkspaceCandidateDecision } from "@/lib/workspace/types";

function supersedesTarget(edgeType: string) {
  return edgeType === "supersedes" || edgeType === "replaces";
}

// Creates a user-confirmed edge and applies its status side effects:
// supersedes/replaces marks the target superseded; resolves closes the target
// (mirrors the resolve_open_question semantics — the MCP side validates that
// resolves targets are active open questions before proposing).
async function applyConfirmedEdge({
  projectId,
  topicId,
  sourceDecisionId,
  targetDecisionId,
  type,
  candidateId,
}: {
  projectId: string;
  topicId: string;
  sourceDecisionId: string;
  targetDecisionId: string;
  type: string;
  candidateId: string;
}) {
  await insertEdge({
    projectId,
    topicId,
    sourceDecisionId,
    targetDecisionId,
    type,
  });

  if (supersedesTarget(type)) {
    await updateDecisionStatus({
      decisionId: targetDecisionId,
      status: "superseded",
    });
    await insertDecisionLog({
      decisionId: targetDecisionId,
      candidateId,
      action: "superseded",
      actorType: "user",
      metadata: {
        supersededByDecisionId: sourceDecisionId,
      },
    });
  }

  if (type === "resolves") {
    await updateDecisionStatus({
      decisionId: targetDecisionId,
      status: "archived",
    });
    await insertDecisionLog({
      decisionId: targetDecisionId,
      candidateId,
      action: "archived",
      actorType: "user",
      metadata: {
        resolvedByDecisionId: sourceDecisionId,
      },
    });
  }
}

function getCandidateCodeAnchors(candidate: WorkspaceCandidateDecision) {
  return normalizeCodeAnchors(candidate.sourceMetadata?.code_anchors_at_write);
}

async function confirmCreateCandidate({
  candidate,
  userId,
}: {
  candidate: WorkspaceCandidateDecision;
  userId: string;
}) {
  const createdDecision = await insertDecision({
    projectId: candidate.projectId,
    topicId: candidate.topicId,
    title: candidate.proposedTitle ?? "Untitled decision",
    content: candidate.proposedContent,
    rationale: candidate.proposedRationale,
    kind: candidate.proposedKind ?? "plan",
    weight: candidate.proposedWeight ?? "normal",
    status: "active",
    relevantMessageIds: candidate.relevantMessageIds,
    codeAnchors: getCandidateCodeAnchors(candidate),
    createdFromMessageId: candidate.messageId,
    confirmedByUserId: userId,
  });

  await updateCandidateResolution({
    candidateId: candidate.id,
    status: "accepted",
    resolvedDecisionId: createdDecision.id,
  });

  await insertDecisionLog({
    decisionId: createdDecision.id,
    candidateId: candidate.id,
    action: "created",
    actorType: "user",
  });

  for (const suggestedEdge of candidate.suggestedEdges ?? []) {
    if (!suggestedEdge.targetDecisionId) {
      continue;
    }

    await applyConfirmedEdge({
      projectId: candidate.projectId,
      topicId: candidate.topicId,
      sourceDecisionId: createdDecision.id,
      targetDecisionId: suggestedEdge.targetDecisionId,
      type: suggestedEdge.type,
      candidateId: candidate.id,
    });
  }
}

async function confirmCreateEdgeCandidate({
  candidate,
}: {
  candidate: WorkspaceCandidateDecision;
}) {
  if (!candidate.proposedForDecisionId) {
    throw new ChatbotError(
      "bad_request:api",
      "Edge candidate is missing proposed_for_decision_id"
    );
  }

  const suggestedEdges = (candidate.suggestedEdges ?? []).filter(
    (edge): edge is { type: string; targetDecisionId: string } =>
      Boolean(edge.targetDecisionId)
  );

  if (suggestedEdges.length === 0) {
    throw new ChatbotError(
      "bad_request:api",
      "Edge candidate is missing suggested_edges"
    );
  }

  for (const edge of suggestedEdges) {
    await applyConfirmedEdge({
      projectId: candidate.projectId,
      topicId: candidate.topicId,
      sourceDecisionId: candidate.proposedForDecisionId,
      targetDecisionId: edge.targetDecisionId,
      type: edge.type,
      candidateId: candidate.id,
    });
  }

  await updateCandidateResolution({
    candidateId: candidate.id,
    status: "accepted",
    resolvedDecisionId: candidate.proposedForDecisionId,
  });

  await insertDecisionLog({
    decisionId: candidate.proposedForDecisionId,
    candidateId: candidate.id,
    action: "create_edge",
    actorType: "user",
    metadata: {
      proposedIntent: "create_edge",
    },
  });
}

async function confirmDeleteEdgeCandidate({
  candidate,
}: {
  candidate: WorkspaceCandidateDecision;
}) {
  const edgeId =
    typeof candidate.sourceMetadata?.edge_id === "string"
      ? candidate.sourceMetadata.edge_id
      : null;

  if (!edgeId) {
    throw new ChatbotError(
      "bad_request:api",
      "Delete-edge candidate is missing edge_id"
    );
  }

  await deleteEdgeById(edgeId);

  await updateCandidateResolution({
    candidateId: candidate.id,
    status: "accepted",
    resolvedDecisionId: candidate.proposedForDecisionId,
  });

  await insertDecisionLog({
    decisionId: candidate.proposedForDecisionId,
    candidateId: candidate.id,
    action: "delete_edge",
    actorType: "user",
    metadata: {
      proposedIntent: "delete_edge",
      edgeId,
    },
  });
}

async function confirmUpdateCandidate({
  candidate,
}: {
  candidate: WorkspaceCandidateDecision;
}) {
  if (!candidate.proposedForDecisionId) {
    throw new ChatbotError(
      "bad_request:api",
      "Update candidate is missing proposed_for_decision_id"
    );
  }

  const updated = await updateDecision({
    decisionId: candidate.proposedForDecisionId,
    title: candidate.proposedTitle ?? undefined,
    content: candidate.proposedContent,
    rationale: candidate.proposedRationale,
    kind: candidate.proposedKind ?? undefined,
    weight: candidate.proposedWeight ?? undefined,
    codeAnchors: getCandidateCodeAnchors(candidate),
  });

  await updateCandidateResolution({
    candidateId: candidate.id,
    status: "accepted",
    resolvedDecisionId: updated.id,
  });

  await insertDecisionLog({
    decisionId: updated.id,
    candidateId: candidate.id,
    action: "updated",
    actorType: "user",
    metadata: {
      proposedIntent: "update",
    },
  });
}

async function confirmArchiveCandidate({
  candidate,
}: {
  candidate: WorkspaceCandidateDecision;
}) {
  if (!candidate.proposedForDecisionId) {
    throw new ChatbotError(
      "bad_request:api",
      "Archive candidate is missing proposed_for_decision_id"
    );
  }

  const archived = await updateDecisionStatus({
    decisionId: candidate.proposedForDecisionId,
    status: candidate.proposedStatus ?? "archived",
  });

  await updateCandidateResolution({
    candidateId: candidate.id,
    status: "accepted",
    resolvedDecisionId: archived.id,
  });

  await insertDecisionLog({
    decisionId: archived.id,
    candidateId: candidate.id,
    action: "archived",
    actorType: "user",
    metadata: {
      proposedIntent: "archive",
    },
  });
}

async function confirmSupersedeCandidate({
  candidate,
  userId,
}: {
  candidate: WorkspaceCandidateDecision;
  userId: string;
}) {
  if (!candidate.proposedForDecisionId) {
    throw new ChatbotError(
      "bad_request:api",
      "Supersede candidate is missing proposed_for_decision_id"
    );
  }

  const createdDecision = await insertDecision({
    projectId: candidate.projectId,
    topicId: candidate.topicId,
    title: candidate.proposedTitle ?? "Untitled decision",
    content: candidate.proposedContent,
    rationale: candidate.proposedRationale,
    kind: candidate.proposedKind ?? "plan",
    weight: candidate.proposedWeight ?? "normal",
    status: "active",
    relevantMessageIds: candidate.relevantMessageIds,
    codeAnchors: getCandidateCodeAnchors(candidate),
    createdFromMessageId: candidate.messageId,
    confirmedByUserId: userId,
  });

  await updateDecisionStatus({
    decisionId: candidate.proposedForDecisionId,
    status: "superseded",
  });

  await insertEdge({
    projectId: candidate.projectId,
    topicId: candidate.topicId,
    sourceDecisionId: createdDecision.id,
    targetDecisionId: candidate.proposedForDecisionId,
    type: "supersedes",
  });

  await updateCandidateResolution({
    candidateId: candidate.id,
    status: "accepted",
    resolvedDecisionId: createdDecision.id,
  });

  await insertDecisionLog({
    decisionId: createdDecision.id,
    candidateId: candidate.id,
    action: "superseded",
    actorType: "user",
    metadata: {
      supersededDecisionId: candidate.proposedForDecisionId,
    },
  });

  await insertDecisionLog({
    decisionId: candidate.proposedForDecisionId,
    candidateId: candidate.id,
    action: "superseded",
    actorType: "user",
    metadata: {
      supersededByDecisionId: createdDecision.id,
    },
  });
}

export async function confirmCandidates({
  userId,
  topicId,
  selectedCandidateIds,
}: {
  userId: string;
  topicId: string;
  selectedCandidateIds: string[];
}) {
  const topic = await getTopicByIdForUser(topicId, userId);

  if (!topic) {
    throw new ChatbotError("forbidden:chat", "Topic not found");
  }

  const pendingCandidates = await listPendingCandidatesByTopicId(topicId);
  const selectedSet = new Set(selectedCandidateIds);

  for (const candidate of pendingCandidates) {
    if (!selectedSet.has(candidate.id)) {
      await updateCandidateResolution({
        candidateId: candidate.id,
        status: "rejected",
      });
      await insertDecisionLog({
        candidateId: candidate.id,
        action: "candidate_rejected",
        actorType: "user",
      });
      continue;
    }

    switch (candidate.proposedIntent ?? "create") {
      case "update":
        await confirmUpdateCandidate({ candidate });
        break;
      case "archive":
        await confirmArchiveCandidate({ candidate });
        break;
      case "supersede":
        await confirmSupersedeCandidate({ candidate, userId });
        break;
      case "create_edge":
        await confirmCreateEdgeCandidate({ candidate });
        break;
      case "delete_edge":
        await confirmDeleteEdgeCandidate({ candidate });
        break;
      default:
        await confirmCreateCandidate({ candidate, userId });
        break;
    }
  }
}

export async function dismissAllCandidates({
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

  const pendingCandidates = await listPendingCandidatesByTopicId(topicId);

  for (const candidate of pendingCandidates) {
    await updateCandidateResolution({
      candidateId: candidate.id,
      status: "rejected",
    });
    await insertDecisionLog({
      candidateId: candidate.id,
      action: "candidate_rejected",
      actorType: "user",
    });
  }
}
