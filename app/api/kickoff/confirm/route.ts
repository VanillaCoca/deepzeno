import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import {
  createIRNodeForUser,
  findDuplicateIRCandidate,
  getKickoffStateForProject,
  logIREvent,
} from "@/lib/ir/queries";
import {
  KICKOFF_LIMITS,
  kickoffNodeKinds,
  statusForConfidence,
} from "@/lib/kickoff/proposal";
import {
  getProjectByIdForUser,
  listTopicsByProjectId,
} from "@/lib/workspace/queries";
import { createTopicWithConversation } from "@/lib/workspace/service";

const bodySchema = z.object({
  project_id: z.string().uuid(),
  topics: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        charter: z.string().min(1).max(500),
        nodes: z
          .array(
            z.object({
              kind: z.enum(kickoffNodeKinds),
              title: z.string().min(1).max(200),
              content: z.string().max(2000).nullable(),
              rationale: z.string().max(2000).nullable(),
              confidence: z.number().min(0).max(1),
            })
          )
          .max(KICKOFF_LIMITS.maxNodesPerTopic),
      })
    )
    .min(1)
    .max(KICKOFF_LIMITS.maxTopics),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = bodySchema.parse(await request.json());
    const userId = session.user.id;
    const project = await getProjectByIdForUser(body.project_id, userId);

    if (!project) {
      return new ChatbotError(
        "forbidden:chat",
        "Project not found"
      ).toResponse();
    }

    const state = await getKickoffStateForProject(body.project_id);

    if (state === "confirmed") {
      return new ChatbotError(
        "bad_request:api",
        "Kickoff already confirmed for this project"
      ).toResponse();
    }

    // Step 1: the user confirmed the decomposition — create the topics through
    // the existing provisioning path, charter stored as the description.
    // Step 2: land each seed node under its real topic id as pending/idea.
    // Nothing here writes truth (Iron Law 0); nodes go through the normal
    // confirm flow later.
    let pendingCreated = 0;
    let ideasCreated = 0;
    const createdTopics: Array<{ id: string; label: string }> = [];

    // Retry safety: load existing topics once so we can reuse any that were
    // already created by a previous partially-failed confirm run.
    const existingTopics = await listTopicsByProjectId(body.project_id);

    for (const topicProposal of body.topics) {
      // Retry safety: a previous partially-failed confirm may already have
      // created this topic. Reuse it instead of duplicating. Never capture
      // the General topic — a proposal named "General" must create its own.
      const existingTopic = existingTopics.find(
        (topic) =>
          !(topic.archivedAt || topic.isGeneral) &&
          topic.label === topicProposal.name
      );
      const topicRecord = existingTopic
        ? { id: existingTopic.id, label: existingTopic.label }
        : await createTopicWithConversation({
            userId,
            projectId: body.project_id,
            label: topicProposal.name,
            description: topicProposal.charter,
          }).then((bundle) => ({
            id: bundle.topic.id,
            label: bundle.topic.label,
          }));
      createdTopics.push(topicRecord);

      for (const node of topicProposal.nodes) {
        const duplicate = await findDuplicateIRCandidate({
          projectId: body.project_id,
          kind: node.kind,
          subtype: null,
          title: node.title,
        });

        if (duplicate) {
          continue;
        }

        const initialStatus = statusForConfidence(node.confidence);

        await createIRNodeForUser({
          userId,
          projectId: body.project_id,
          topicId: topicRecord.id,
          kind: node.kind,
          subtype: null,
          title: node.title,
          content: node.content,
          rationale: node.rationale,
          sourceLayer: "kickoff",
          createdBy: "ai",
          initialStatus,
          extractionConfidence: node.confidence,
        });

        if (initialStatus === "pending") {
          pendingCreated += 1;
        } else {
          ideasCreated += 1;
        }
      }
    }

    await logIREvent({
      projectId: body.project_id,
      event: "kickoff_confirmed",
      layer: "kickoff",
      metadata: {
        topicsCreated: createdTopics.length,
        pendingCreated,
        ideasCreated,
      },
    });

    return Response.json(
      {
        topics: createdTopics,
        pending_created: pendingCreated,
        ideas_created: ideasCreated,
      },
      { status: 201 }
    );
  } catch (error) {
    return irErrorToResponse(error, "Kickoff confirmation failed");
  }
}
