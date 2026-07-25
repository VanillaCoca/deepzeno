import "server-only";

import { buildInboxItems, type InboxItem } from "@/lib/ir/inbox-core";
import { listIREdgesForProject, listIRNodesForUser } from "@/lib/ir/queries";

/**
 * Assemble the cross-topic pending queue for a project (PRD K1).
 *
 * Read-only: every ruling still flows through the existing /api/ir/[id]/*
 * endpoints (PRD K5, Iron Law 4). No schema change, no new write path.
 *
 * `listIRNodesForUser` with `status: "pending"` and no `topicId` returns every
 * pending node in the project — assigned and unassigned, across all topics — in
 * one call, and only asserts project access. Idea nodes are excluded by
 * construction (PRD D0-NG4).
 */
export async function listPendingInboxForUser({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}): Promise<InboxItem[]> {
  const [pendingNodes, activeNodes, edges] = await Promise.all([
    listIRNodesForUser({ userId, projectId, status: "pending" }),
    listIRNodesForUser({ userId, projectId, status: "active" }),
    listIREdgesForProject({ userId, projectId }),
  ]);

  return buildInboxItems({ pendingNodes, activeNodes, edges });
}
