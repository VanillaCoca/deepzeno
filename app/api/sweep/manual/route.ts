import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { logIREvent } from "@/lib/ir/queries";
import type { IRSweepResult } from "@/lib/ir/sweep";
import { runIRSweep } from "@/lib/ir/sweep";
import {
  createResearchRun,
  updateResearchRun,
  writeRunCheckpoint,
} from "@/lib/research/queries";
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

const BLOCKING_MODEL_SOFT_TIMEOUT_MS = 30_000;
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

/**
 * Give this sweep a row in `research_run` so it shows up as work in flight.
 *
 * Sweep is the least visible operation in the product: the user clicks
 * "explore", the conversation is swapped out from under them, and 12–30s later
 * candidates appear in the Inbox with nothing saying where they came from. The
 * run row is what the activity bar reads.
 *
 * Best-effort on purpose. On a database that has not taken migration 0006 yet,
 * `origin_node_id` is still NOT NULL and this insert fails — a sweep must not
 * die because its progress bar could not be created. Null means "no bar", not
 * "no sweep".
 */
async function openSweepRun({
  projectId,
  topicId,
}: {
  projectId: string;
  topicId: string | null;
}): Promise<string | null> {
  try {
    const run = await createResearchRun({
      projectId,
      topicId,
      // A sweep extracts from a conversation. There is no originating IR node
      // for it to hang off — that is what 0006 made nullable.
      originNodeId: null,
      budget: null,
      runType: "sweep",
    });

    return run.id;
  } catch (error) {
    console.warn("Could not open a run row for manual sweep", error);
    return null;
  }
}

/**
 * Settle the run row once the sweep actually finishes.
 *
 * `runIRSweep` reports failure by returning `status: "failed"` rather than
 * throwing, so both shapes have to be handled or a failed sweep would sit on
 * screen as running forever.
 *
 * A `skipped` sweep settles as `done`: nothing went wrong, there was simply
 * nothing new in the conversation to extract. Saying "partial" there would
 * invite the user to go looking for work that was never dropped.
 */
async function closeSweepRun({
  runId,
  result,
  error,
}: {
  runId: string;
  result?: IRSweepResult;
  error?: unknown;
}): Promise<void> {
  const message =
    result?.error ?? (error instanceof Error ? error.message : undefined);
  const failed = result ? result.status === "failed" : true;

  try {
    await updateResearchRun({
      id: runId,
      status: failed ? "failed" : "done",
      error: failed ? (message ?? "Sweep failed") : null,
      finishedAt: new Date().toISOString(),
      progress: {
        phase: "extract",
        at: new Date().toISOString(),
        ...(result === undefined
          ? {}
          : { candidates: result.candidatesCreated }),
      },
    });
  } catch (updateError) {
    // The activity bar's staleness rule is the backstop for what this misses.
    console.warn("Could not settle sweep run row", updateError);
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

    const runId = await openSweepRun({
      projectId: project.id,
      topicId: conversation.topicId,
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

    if (runId) {
      // Not awaited: the checkpoint only moves the rail off "pending", and the
      // sweep should not wait a round trip for its own progress bar.
      //
      // Sweep gets no cancel button this round. It runs 12–30s, so by the time
      // the bar is on screen it is nearly over, and the only way to interrupt
      // it runs through 950 lines of extraction logic for about a fifth of a
      // cent. Visibility is the whole win here.
      void writeRunCheckpoint({
        id: runId,
        progress: { phase: "extract", at: new Date().toISOString() },
      });

      // Settlement rides on the sweep promise itself rather than on whatever
      // the request awaits. When the blocking branch times out at 60s the
      // sweep is still running, and a row settled `failed` at that moment
      // would be a lie about work still in flight that may yet land
      // candidates. This also gives the promise a terminal rejection handler
      // on the blocking-timeout path, where it previously had none.
      sweepPromise
        .then(
          (result) => closeSweepRun({ runId, result }),
          (error) => closeSweepRun({ runId, error })
        )
        .catch(() => {
          // Settling is best-effort; closeSweepRun already logged.
        });
    }

    if (body.blocking) {
      const result = await withTimeout(sweepPromise, 60_000);

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
