"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import type { IRType } from "@/lib/ir-types";
import {
  createProjectForUser,
  createTopicForProject,
  insertDecision,
} from "@/lib/workspace/queries";

type ConfirmTopicPayload = {
  name: string;
  decisions: Array<{
    type: IRType;
    content: string;
  }>;
};

export type ConfirmExtractionPayload = {
  projectName: string;
  topics: ConfirmTopicPayload[];
};

function ensureAuthenticatedUserId(session: Awaited<ReturnType<typeof auth>>) {
  const userId = session?.user?.id;

  if (!userId) {
    throw new ChatbotError("unauthorized:chat");
  }

  return userId;
}

function normalizeName(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function createBlankProject() {
  const session = await auth();
  const userId = ensureAuthenticatedUserId(session);
  const project = await createProjectForUser({
    userId,
    name: "Untitled project",
  });

  revalidatePath("/");

  return {
    projectId: project.id,
  };
}

export async function confirmExtraction(payload: ConfirmExtractionPayload) {
  const session = await auth();
  const userId = ensureAuthenticatedUserId(session);
  const projectName = normalizeName(payload.projectName, "Untitled project");
  const project = await createProjectForUser({
    userId,
    name: projectName,
  });

  for (const [topicIndex, topic] of payload.topics.entries()) {
    const decisions = topic.decisions.filter(
      (decision) => decision.content.trim().length > 0
    );

    if (decisions.length === 0) {
      continue;
    }

    const createdTopic = await createTopicForProject({
      projectId: project.id,
      label: normalizeName(topic.name, `Topic ${topicIndex + 1}`),
      position: topicIndex,
    });

    for (const decision of decisions) {
      const content = decision.content.trim();

      await insertDecision({
        projectId: project.id,
        topicId: createdTopic.id,
        title: content,
        content,
        kind: decision.type,
        status: "active",
        weight: "normal",
      });
    }
  }

  revalidatePath("/");

  return {
    projectId: project.id,
  };
}
