import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { logIREvent } from "@/lib/ir/queries";
import { runIRSweep } from "@/lib/ir/sweep";
import { generateUUID } from "@/lib/utils";
import {
  getConversationByIdForUser,
  getProjectByIdForUser,
} from "@/lib/workspace/queries";

const sweepSchema = z.object({
  project_id: z.string().uuid(),
  chat_session_id: z.string().uuid(),
  blocking: z.boolean().default(false),
});

const BLOCKING_MODEL_SOFT_TIMEOUT_MS = 2500;
const QUEUED_MODEL_SOFT_TIMEOUT_MS = 12_000;

class SweepTimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new SweepTimeoutError("Manual sweep exceeded timeout."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = sweepSchema.parse(await request.json());
    const project = await getProjectByIdForUser(
      body.project_id,
      session.user.id
    );

    const conversation = await getConversationByIdForUser(
      body.chat_session_id,
      session.user.id
    );

    if (!(project && conversation) || conversation.projectId !== project.id) {
      return new ChatbotError(
        "forbidden:chat",
        "Project or chat session not found"
      ).toResponse();
    }

    const sweepId = generateUUID();
    await logIREvent({
      projectId: body.project_id,
      topicId: conversation.topicId,
      event: "sweep_triggered",
      layer: "sweep",
      metadata: {
        sweepId,
        trigger: "manual",
        blocking: body.blocking,
        implementation: "llm",
      },
    });

    const sweepPromise = runIRSweep({
      sweepId,
      userId: session.user.id,
      projectId: project.id,
      conversationId: conversation.id,
      modelSoftTimeoutMs: body.blocking
        ? BLOCKING_MODEL_SOFT_TIMEOUT_MS
        : QUEUED_MODEL_SOFT_TIMEOUT_MS,
    });

    if (body.blocking) {
      const result = await withTimeout(sweepPromise, 10_000);

      if (result.status === "failed") {
        return Response.json(
          {
            sweep_id: sweepId,
            status: "failed",
            candidates_created: result.candidatesCreated,
            ideas_created: result.ideasCreated,
            duration_ms: result.durationMs,
            error: result.error,
          },
          { status: 500 }
        );
      }

      return Response.json({
        sweep_id: sweepId,
        status: result.status === "skipped" ? "skipped" : "completed",
        candidates_created: result.candidatesCreated,
        ideas_created: result.ideasCreated,
        duplicates_skipped: result.duplicatesSkipped,
        chunks_processed: result.chunksProcessed,
        turns_processed: result.turnsProcessed,
        duration_ms: result.durationMs,
        model: result.model,
      });
    }

    sweepPromise.catch((error) => {
      console.error("Queued manual IR sweep failed", error);
    });

    return Response.json({ sweep_id: sweepId, status: "queued" });
  } catch (error) {
    if (error instanceof SweepTimeoutError) {
      return Response.json(
        {
          code: "timeout:sweep",
          message: error.message,
        },
        { status: 408 }
      );
    }

    return irErrorToResponse(error, "Manual sweep failed");
  }
}
