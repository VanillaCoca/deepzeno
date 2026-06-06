import "server-only";

import { normalizeCodeAnchors } from "@/lib/decision-anchors";
import { ChatbotError } from "@/lib/errors";
import {
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

    await insertEdge({
      projectId: candidate.projectId,
      topicId: candidate.topicId,
      sourceDecisionId: createdDecision.id,
      targetDecisionId: suggestedEdge.targetDecisionId,
      type: suggestedEdge.type,
    });

    if (supersedesTarget(suggestedEdge.type)) {
      await updateDecisionStatus({
        decisionId: suggestedEdge.targetDecisionId,
        status: "superseded",
      });
      await insertDecisionLog({
        decisionId: suggestedEdge.targetDecisionId,
        candidateId: candidate.id,
        action: "superseded",
        actorType: "user",
        metadata: {
          supersededByDecisionId: createdDecision.id,
        },
      });
    }
  }
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
