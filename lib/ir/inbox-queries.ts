import "server-only";

import { buildInboxItems, type InboxItem } from "@/lib/ir/inbox-core";
import {
  countIRNodesByStatus,
  listIREdgesForProject,
  listIRNodesForUser,
} from "@/lib/ir/queries";

export type InboxPayload = {
  items: InboxItem[];
  /**
   * How many `idea` nodes exist that the queue deliberately does not show.
   *
   * Keeping ideas out of the ruling queue is the right call and stays (PRD
   * D0-NG4): the inbox spends the user's scarcest resource — confirmation —
   * and an idea is by definition not yet a claim asking for a ruling. What
   * was wrong was doing it in total silence. The system generated 61 of these
   * and told the user about none of them; there was no count, no filter, no
   * hint that the list on screen was a subset. "Prefer to miss than to make
   * up" licenses dropping the claim, not hiding that a drop happened.
   *
   * A count, not the nodes: the point is to make the omission visible, not to
   * pay for a second full fetch on every inbox poll.
   */
  ideaCount: number;
};

/**
 * Assemble the cross-topic pending queue for a project (PRD K1).
 *
 * Read-only: every ruling still flows through the existing /api/ir/[id]/*
 * endpoints (PRD K5, Iron Law 4). No schema change, no new write path.
 *
 * `listIRNodesForUser` with `status: "pending"` and no `topicId` returns every
 * pending node in the project — assigned and unassigned, across all topics — in
 * one call, and only asserts project access.
 */
export async function listPendingInboxForUser({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}): Promise<InboxPayload> {
  const [pendingNodes, activeNodes, edges, ideaCount] = await Promise.all([
    listIRNodesForUser({ userId, projectId, status: "pending" }),
    listIRNodesForUser({ userId, projectId, status: "active" }),
    listIREdgesForProject({ userId, projectId }),
    // Access is already asserted by the list calls above, which share this
    // project id and run in the same batch.
    countIRNodesByStatus({ projectId, status: "idea" }),
  ]);

  return {
    items: buildInboxItems({ pendingNodes, activeNodes, edges }),
    ideaCount,
  };
}
