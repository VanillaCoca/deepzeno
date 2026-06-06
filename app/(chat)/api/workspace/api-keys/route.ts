import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import {
  createProjectApiKeyForUser,
  listProjectApiKeysForUser,
} from "@/lib/mcp/api-keys";

const searchSchema = z.object({
  projectId: z.string().uuid(),
});

const createSchema = z.object({
  projectId: z.string().uuid(),
  label: z.string().max(120).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const { searchParams } = new URL(request.url);
    const input = searchSchema.parse({
      projectId: searchParams.get("projectId"),
    });

    const apiKeys = await listProjectApiKeysForUser({
      projectId: input.projectId,
      userId: session.user.id,
    });

    return Response.json({ apiKeys });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new ChatbotError(
        "bad_request:api",
        "projectId is required"
      ).toResponse();
    }

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Load API keys failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = createSchema.parse(await request.json());
    const created = await createProjectApiKeyForUser({
      projectId: body.projectId,
      userId: session.user.id,
      label: body.label,
    });

    const apiKeys = await listProjectApiKeysForUser({
      projectId: body.projectId,
      userId: session.user.id,
    });

    return Response.json({
      apiKeys,
      createdKey: {
        id: created.apiKey.id,
        keyPrefix: created.apiKey.keyPrefix,
        label: created.apiKey.label,
        token: created.token,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new ChatbotError(
        "bad_request:api",
        "Invalid API key request"
      ).toResponse();
    }

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Create API key failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }
}
