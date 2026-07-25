import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getIRNodeForUser } from "@/lib/ir/queries";
import { resolveResearchBudget } from "@/lib/research/budget";
import { runResearchPipeline } from "@/lib/research/pipeline";
import { listRecentRunCosts } from "@/lib/research/queries";
import {
  BUDGET_BOUNDS,
  clampBudgetOverride,
  medianCost,
} from "@/lib/research/run-progress-core";
import { ResearchToolUnavailableError } from "@/lib/research/search";

// A default-budget run (≤6 searches, ≤10 fetches, 3 model phases) fits one
// Fluid Compute invocation; the run row records partial/failed states.
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

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = bodySchema.parse(await request.json());
    const node = await getIRNodeForUser({
      id: body.node_id,
      userId: session.user.id,
    });

    if (!node) {
      return new ChatbotError(
        "not_found:chat",
        "IR node not found"
      ).toResponse();
    }

    const result = await runResearchPipeline({
      userId: session.user.id,
      originNodeId: body.node_id,
      budgetOverride: clampBudgetOverride({
        maxSearches: body.max_searches,
        maxFetches: body.max_fetches,
      }),
    });

    return Response.json(
      {
        run: result.run,
        evidence_count: result.evidenceCount,
        candidates_created: result.candidatesCreated,
        skipped_duplicates: result.skippedDuplicates,
      },
      { status: 201 }
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
