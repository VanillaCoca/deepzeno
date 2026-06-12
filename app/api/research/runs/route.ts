import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getIRNodeForUser } from "@/lib/ir/queries";
import {
  listResearchRunsForNode,
  type ResearchRun,
} from "@/lib/research/queries";

const STALE_RUNNING_MS = 10 * 60 * 1000;

function presentRun(run: ResearchRun): ResearchRun {
  const isStale =
    run.status === "running" &&
    Date.now() - new Date(run.createdAt).getTime() > STALE_RUNNING_MS;

  if (!isStale) {
    return run;
  }

  // Display-only rewrite: a crashed invocation can't update its own row.
  return {
    ...run,
    status: "failed",
    error: "Run did not complete (timed out or crashed)",
  };
}

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const nodeId = new URL(request.url).searchParams.get("nodeId");

    if (!nodeId) {
      return new ChatbotError(
        "bad_request:api",
        "nodeId required"
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

    const runs = await listResearchRunsForNode({ nodeId });

    return Response.json({ runs: runs.map(presentRun) });
  } catch (error) {
    return irErrorToResponse(error, "Failed to list research runs");
  }
}
