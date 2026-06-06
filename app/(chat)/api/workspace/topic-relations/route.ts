import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import {
  createTopicRelationForUser,
  listTopicRelationsForUser,
} from "@/lib/workspace/service";
import { topicRelationTypes } from "@/lib/workspace/types";

const querySchema = z.object({
  project_id: z.string().uuid(),
});

const requestSchema = z.object({
  project_id: z.string().uuid(),
  from_topic_id: z.string().uuid(),
  to_topic_id: z.string().uuid(),
  relation_type: z.enum(topicRelationTypes),
});

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({
      project_id: searchParams.get("project_id"),
    });
    const relations = await listTopicRelationsForUser({
      userId: session.user.id,
      projectId: input.project_id,
    });

    return Response.json({ relations });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("List topic relations failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = requestSchema.parse(await request.json());
    const result = await createTopicRelationForUser({
      userId: session.user.id,
      projectId: body.project_id,
      fromTopicId: body.from_topic_id,
      toTopicId: body.to_topic_id,
      relationType: body.relation_type,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Create topic relation failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
