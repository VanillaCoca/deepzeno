import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getIRNodeForUser } from "@/lib/ir/queries";
import { runResearchPipeline } from "@/lib/research/pipeline";
import { ResearchToolUnavailableError } from "@/lib/research/search";

// A default-budget run (≤6 searches, ≤10 fetches, 3 model phases) fits one
// Fluid Compute invocation; the run row records partial/failed states.
export const maxDuration = 300;

const bodySchema = z.object({ node_id: z.string().min(1) });

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
