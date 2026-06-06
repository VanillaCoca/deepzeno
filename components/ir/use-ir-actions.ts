"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { KeyedMutator } from "swr";
import { useIR } from "@/components/ir/ir-provider";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { IRDetail, IRKind, IRNode } from "@/lib/ir/types";
import { getIRTypeLabel } from "@/lib/ir/types";

export async function postJSON<T>(
  path: string,
  body?: Record<string, unknown>
) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.cause ?? payload?.message ?? "Request failed");
  }

  return (await response.json()) as T;
}

export function useIRActions(
  selectedNode: IRNode | null,
  mutateDetail: KeyedMutator<IRDetail>
) {
  const { refreshIR, selectNode } = useIR();
  const { activeTopicId, bringDecisionToSandbox, topics } = useWorkspace();

  const [kindChoice, setKindChoice] = useState("plan:decision");
  const [assignmentTopicId, setAssignmentTopicId] = useState("");
  const [newTopicLabel, setNewTopicLabel] = useState("");
  const [isMutating, setIsMutating] = useState(false);

  const assignableTopics = useMemo(
    () =>
      topics.filter(
        (topic) =>
          !topic.isGeneral &&
          !topic.archivedAt &&
          topic.status !== "superseded" &&
          topic.status !== "dismissed"
      ),
    [topics]
  );

  // Seed assignmentTopicId / newTopicLabel when an unassigned node is selected
  useEffect(() => {
    if (!selectedNode || selectedNode.topicId) {
      return;
    }

    const preferred =
      assignableTopics.find((topic) => topic.id === activeTopicId)?.id ??
      assignableTopics[0]?.id ??
      "";

    setAssignmentTopicId(preferred);
    setNewTopicLabel("");
  }, [activeTopicId, assignableTopics, selectedNode]);

  async function runMutation(
    action: () => Promise<
      { node?: IRNode; new_id?: string } | IRDetail | unknown
    >,
    successMessage: string
  ) {
    setIsMutating(true);

    try {
      const payload = await action();
      await refreshIR();
      await mutateDetail();

      if (payload && typeof payload === "object") {
        const record = payload as { node?: IRNode; new_id?: string };
        const nextId = record.node?.id ?? record.new_id;

        if (nextId) {
          selectNode(nextId);
        }
      }

      toast.success(successMessage);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "IR update failed.");
    } finally {
      setIsMutating(false);
    }
  }

  function getAssignmentPayload(node: IRNode) {
    if (node.topicId) {
      return {};
    }

    const createTopicLabel = newTopicLabel.trim();

    if (createTopicLabel) {
      return { create_topic_label: createTopicLabel };
    }

    if (assignmentTopicId) {
      return { assign_to_topic_id: assignmentTopicId };
    }

    toast.error("Choose a judgment topic before confirming.");
    return null;
  }

  async function handleReclassify(node: IRNode) {
    const [kind, subtype] = kindChoice.split(":") as [
      IRKind,
      string | undefined,
    ];
    await runMutation(
      () =>
        postJSON<{ node: IRNode; new_id: string }>(
          `/api/ir/${node.id}/reclassify`,
          {
            kind,
            subtype: subtype === "_" ? null : subtype,
          }
        ),
      "Kind updated."
    );
  }

  function handleBringToSandbox(node: IRNode) {
    const success = bringDecisionToSandbox({
      decisionId: node.id,
      decisionTitle: node.title,
      kind: getIRTypeLabel(node.kind, node.subtype),
      content: node.content ?? node.title,
      rationale: node.rationale,
    });

    if (success) {
      toast.success("Loaded into sandbox.");
    }
  }

  async function handleConfirmNode(node: IRNode) {
    const assignment = getAssignmentPayload(node);

    if (!assignment) {
      return;
    }

    await runMutation(
      () =>
        postJSON<IRDetail>(`/api/ir/${node.id}/confirm`, {
          ...assignment,
        }),
      "Candidate confirmed."
    );
    setNewTopicLabel("");
  }

  async function handleDismissCandidate(node: IRNode) {
    await runMutation(
      () => postJSON(`/api/ir/${node.id}/dismiss`),
      "Candidate ignored."
    );
  }

  async function handlePromoteIdea(node: IRNode) {
    await runMutation(
      () => postJSON(`/api/ir/${node.id}/promote`),
      "Idea promoted."
    );
  }

  async function handleDismissIdea(node: IRNode) {
    await runMutation(
      () => postJSON(`/api/ir/${node.id}/dismiss`),
      "Idea dismissed."
    );
  }

  return {
    // state
    kindChoice,
    setKindChoice,
    assignmentTopicId,
    setAssignmentTopicId,
    newTopicLabel,
    setNewTopicLabel,
    isMutating,
    // derived
    assignableTopics,
    // handlers
    runMutation,
    handleReclassify,
    handleBringToSandbox,
    handleConfirmNode,
    handleDismissCandidate,
    handlePromoteIdea,
    handleDismissIdea,
  };
}
