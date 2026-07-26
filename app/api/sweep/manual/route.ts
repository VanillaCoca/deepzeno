import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { selectModelForTask } from "@/lib/ai/model-policy";
import type { ModelsUsedAccumulator } from "@/lib/billing/cost-core";
import {
  loadUserFunding,
  requireFunding,
  settleUsage,
  withUserFunding,
} from "@/lib/billing/funding";
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

// The sweep continues past the response on the queued path, and `after()` work
// counts against the invocation's budget. 60s (the platform default) would cut
// a slow sweep off right after the blocking branch's own 60s wait, so the tail
// is given room the sweep can actually use.
export const maxDuration = 120;

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

    // Whose money, decided before anything is written down.
    //
    // Asked about the model the sweep will actually reach for rather than a
    // hard-coded default: `ir_extraction` resolves through `getDefaultModelId`
    // today, but a user with a DeepSeek key and no allowance left is funded for
    // a DeepSeek sweep and denied for an Anthropic one, and a duplicated
    // constant here would answer the wrong question the day `TASK_TIER` gains
    // an entry for it.
    //
    // Placed above `openSweepRun` for the same reason the research gate sits
    // above `createResearchRun`: one line further down a run row exists, and
    // from there the only way to refuse is a run that failed — which the user
    // reads as the product breaking rather than as a limit they can lift.
    const funding = await loadUserFunding(session.user.id);
    requireFunding(funding, selectModelForTask("ir_extraction"));

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

    const modelsUsed: ModelsUsedAccumulator = {};
    // `withUserFunding` enters the funding scope synchronously and hands back
    // the sweep's own promise, so the context survives every await inside it —
    // unlike the chat route's sweep, which has to re-enter because `after()`
    // moves the callback to a different async context. The `after(settled)`
    // below only awaits a promise that is already inside the scope.
    const sweepPromise = withUserFunding(funding, () =>
      runIRSweep({
        sweepId,
        userId: session.user.id,
        projectId: project.id,
        conversationId: conversation.id,
        modelSoftTimeoutMs: body.blocking
          ? BLOCKING_MODEL_SOFT_TIMEOUT_MS
          : QUEUED_MODEL_SOFT_TIMEOUT_MS,
        modelsUsed,
      })
    );

    if (runId) {
      // Not awaited: the checkpoint only moves the rail off "pending", and the
      // sweep should not wait a round trip for its own progress bar.
      //
      // Sweep gets no cancel button this round. It runs 12–30s, so by the time
      // the bar is on screen it is nearly over, and the only way to interrupt
      // it runs through 950 lines of extraction logic for about a fifth of a
      // cent. Visibility is the whole win here.
      // `.catch` rather than `void`: a rejected checkpoint write is a lost
      // progress bar, not a lost sweep, but an unhandled rejection in a
      // serverless invocation is a process-level event that can take the
      // sweep down with it.
      writeRunCheckpoint({
        id: runId,
        progress: { phase: "extract", at: new Date().toISOString() },
      }).catch((error) => {
        console.error("Failed to checkpoint sweep run", {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    // Settlement rides on the sweep promise itself rather than on whatever the
    // request awaits. When the blocking branch times out at 60s the sweep is
    // still running, and a row settled `failed` at that moment would be a lie
    // about work still in flight that may yet land candidates. This is also
    // the promise's only terminal rejection handler on the timeout path.
    const settled = sweepPromise
      .then(
        (result) => (runId ? closeSweepRun({ runId, result }) : undefined),
        (error) => {
          console.error("Manual IR sweep failed", error);
          return runId ? closeSweepRun({ runId, error }) : undefined;
        }
      )
      // Chained onto both arms, not onto the success arm: a sweep that dies
      // halfway through a conversation has still paid for every chunk it
      // extracted, and billing only the sweeps that finish leaves a hole in the
      // allowance shaped exactly like the failure-prone path.
      .then(() =>
        settleUsage({
          funding,
          modelsUsed,
          kind: "sweep",
          projectId: project.id,
          runId,
        }).catch((error) => {
          // Loud: silently under-charging is how a free tier becomes an
          // unbounded one. The run row still carries the sweep itself, so what
          // is lost here is the accounting, not the record.
          console.error("Failed to settle sweep usage", {
            sweepId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
      );

    // `after()` is what makes the queued path real. On Vercel a promise the
    // response does not await is frozen the instant the invocation returns:
    // the queued branch below answers `{"status":"queued"}` immediately, so
    // `runIRSweep` was being suspended mid-flight and its run row left at
    // `running` forever. That zombie is not inert — every client's activity
    // bar reads it as work in progress and holds its 5s active poll for as
    // long as the row exists. Registering the tail here keeps the invocation
    // alive until the sweep settles and the row is closed.
    //
    // Registered unconditionally, not inside `if (runId)`: whether the sweep
    // got a progress bar has nothing to do with whether it should be allowed
    // to finish. A failed `openSweepRun` costs the user a bar; it must not
    // also cost them their candidates.
    after(settled);

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

    // No `.catch` here: the `settled` chain above already owns this promise's
    // rejection, and logging it twice would read as two failures.
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
