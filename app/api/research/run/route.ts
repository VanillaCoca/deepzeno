import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getIRNodeForUser } from "@/lib/ir/queries";
import { resolveResearchBudget } from "@/lib/research/budget";
import {
  executeResearchRun,
  prepareResearchRun,
} from "@/lib/research/pipeline";
import { listRecentRunCosts } from "@/lib/research/queries";
import {
  BUDGET_BOUNDS,
  clampBudgetOverride,
  medianCost,
} from "@/lib/research/run-progress-core";
import { ResearchToolUnavailableError } from "@/lib/research/search";

// This route is where a research run lives. The POST hands the response back
// before the pipeline starts, so all 300 seconds belong to the run and nothing
// else — which is the whole reason the run has a route of its own instead of
// being awaited inside whatever request happened to ask for it.
export const maxDuration = 300;

const bodySchema = z.object({
  node_id: z.string().min(1),
  // What the user set in the pre-run panel. Bounded here rather than trusted,
  // because the ceilings are not a preference — they are what one invocation
  // can actually finish inside.
  max_searches: z
    .number()
    .int()
    .min(BUDGET_BOUNDS.maxSearches.min)
    .max(BUDGET_BOUNDS.maxSearches.max)
    .optional(),
  max_fetches: z
    .number()
    .int()
    .min(BUDGET_BOUNDS.maxFetches.min)
    .max(BUDGET_BOUNDS.maxFetches.max)
    .optional(),
});

/**
 * What a run would cost before the user commits to it.
 *
 * The estimate is the median of this project's own finished research runs, not
 * a model-priced forecast. A forecast would be a guess dressed as a number;
 * the median is a measurement, and when there is no history it is null and the
 * panel says so rather than inventing a figure.
 */
export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const nodeId = new URL(request.url).searchParams.get("node_id");

    if (!nodeId) {
      return new ChatbotError(
        "bad_request:api",
        "node_id required"
      ).toResponse();
    }

    const node = await getIRNodeForUser({
      id: nodeId,
      userId: session.user.id,
    });

    if (!node) {
      return new ChatbotError(
        "not_found:chat",
        "IR node not found"
      ).toResponse();
    }

    const budget = resolveResearchBudget();
    const costs = await listRecentRunCosts({
      projectId: node.projectId,
      runType: "research",
    });

    return Response.json({
      budget: {
        max_searches: budget.maxSearches,
        max_fetches: budget.maxFetches,
      },
      bounds: BUDGET_BOUNDS,
      typical_cost: medianCost(costs),
      sample_size: costs.length,
    });
  } catch (error) {
    return irErrorToResponse(error, "Failed to estimate research run");
  }
}

/**
 * Start a run. Accept-and-detach, not request-and-wait.
 *
 * Everything that can be the caller's fault — no session, a node that is not
 * theirs or is not a question, no search provider, a budget out of bounds, an
 * exhausted allowance — is decided before this returns, so the caller still
 * gets a real 4xx/402/503 for a real mistake. That the allowance check lives on
 * this side of the handoff is the whole reason it is worth anything: past this
 * line the only way to refuse a run is to fail it, and a user reads a failed
 * run as the product breaking rather than as a limit they can lift in Settings.
 * What it does not do is hold the connection open for the four
 * minutes of work that follows. That was never a service to anyone: the
 * activity bar already polls the run row, so a caller blocked on the response
 * was watching a spinner while the same progress was being written where it
 * could actually see it.
 *
 * The detached half is where the run's time budget comes from. `after()` runs
 * once the response is sent but inside this invocation, and this invocation
 * has nothing else to spend, which is exactly what a run stranded in a shared
 * `after()` tail did not have.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = bodySchema.parse(await request.json());

    // Throws for a missing node, a non-researchable kind or an unconfigured
    // search provider, and creates the run row. Nothing here is slow and
    // nothing here spends money.
    const prepared = await prepareResearchRun({
      userId: session.user.id,
      originNodeId: body.node_id,
      budgetOverride: clampBudgetOverride({
        maxSearches: body.max_searches,
        maxFetches: body.max_fetches,
      }),
    });

    after(async () => {
      try {
        await executeResearchRun(prepared);
      } catch (error) {
        // The pipeline has already written `failed` onto the row with this
        // message before rethrowing, so there is nothing to recover here —
        // but an unhandled rejection in `after()` would be logged as a
        // platform error rather than as this run's error.
        console.error("Research run failed", {
          runId: prepared.run.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return Response.json(
      { run: prepared.run, accepted: true },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof ResearchToolUnavailableError) {
      return Response.json(
        { code: "service_unavailable:research", message: error.message },
        { status: error.statusCode }
      );
    }

    return irErrorToResponse(error, "Research run failed");
  }
}
