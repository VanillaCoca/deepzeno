"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import type { IRType } from "@/lib/ir-types";
import {
  createProjectFromExtraction,
  createProjectWithDefaults,
} from "@/lib/workspace/service";

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

export async function createBlankProject(name: string) {
  const session = await auth();
  const userId = ensureAuthenticatedUserId(session);
  const userEmail = session?.user?.email ?? null;
  const bundle = await createProjectWithDefaults({
    userId,
    userEmail,
    name: normalizeName(name, "Untitled project"),
  });

  revalidatePath("/");

  return {
    projectId: bundle.project.id,
    topicId: bundle.generalTopic.id,
  };
}

export async function confirmExtraction(payload: ConfirmExtractionPayload) {
  const session = await auth();
  const userId = ensureAuthenticatedUserId(session);
  const userEmail = session?.user?.email ?? null;
  const projectName = normalizeName(payload.projectName, "Untitled project");
  const result = await createProjectFromExtraction({
    userId,
    userEmail,
    projectName,
    topics: payload.topics,
  });

  revalidatePath("/");

  return {
    projectId: result.project.id,
    topicId:
      "activeTopic" in result ? result.activeTopic.id : result.generalTopic.id,
  };
}
