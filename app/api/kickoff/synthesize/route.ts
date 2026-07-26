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
import { getKickoffStateForProject } from "@/lib/ir/queries";
import { runKickoffSynthesis } from "@/lib/kickoff/synthesis";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

const bodySchema = z.object({ project_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = bodySchema.parse(await request.json());
    const project = await getProjectByIdForUser(
      body.project_id,
      session.user.id
    );

    if (!project) {
      return new ChatbotError(
        "forbidden:chat",
        "Project not found"
      ).toResponse();
    }

    const state = await getKickoffStateForProject(body.project_id);

    if (state === "confirmed" || state === "skipped") {
      return new ChatbotError(
        "bad_request:api",
        "Kickoff already completed for this project"
      ).toResponse();
    }

    // The most expensive single call in the product: one frontier-tier
    // generation over the whole intake transcript, and until now it was billed
    // to nobody. Gated against the model it will actually reach for, because
    // "kickoff_synthesis" is tier-routed and the answer changes with the
    // deployment's model set — a user with an Anthropic key of their own is
    // funded here even at zero allowance.
    const funding = await loadUserFunding(session.user.id);
    requireFunding(funding, selectModelForTask("kickoff_synthesis"));

    const modelsUsed: ModelsUsedAccumulator = {};

    try {
      const { proposal, model } = await withUserFunding(funding, () =>
        runKickoffSynthesis({ projectId: body.project_id, modelsUsed })
      );

      return Response.json({ proposal, model });
    } finally {
      // In `finally` rather than after the success path: a synthesis whose
      // response failed to parse has still bought every token it sent. The
      // pre-model guards inside `runKickoffSynthesis` throw with an empty
      // accumulator, and `recordUsage` skips rows of zeroes, so nothing is
      // written for those.
      await settleUsage({
        funding,
        modelsUsed,
        kind: "kickoff",
        projectId: body.project_id,
      }).catch((error) => {
        console.error("Failed to settle kickoff usage", {
          projectId: body.project_id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  } catch (error) {
    return irErrorToResponse(error, "Kickoff synthesis failed");
  }
}
