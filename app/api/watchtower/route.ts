import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getIRNodeForUser, IRNotReadyError } from "@/lib/ir/queries";
import {
  DEFAULT_AGENT_SETTINGS,
  isPatrolCadence,
  PATROL_CADENCES,
} from "@/lib/research/agent-settings";
import {
  createWatch,
  findWatchByNodeId,
  getProjectAgentSettings,
  getWatchById,
  listWatchesByProject,
  updateProjectAgentSettings,
  updateWatch,
} from "@/lib/research/watch-queries";
import { getProjectByIdForUser } from "@/lib/workspace/queries";

// Watch + project-agent-settings management. All writes are user-scoped;
// patrols themselves run via /api/cron/watchtower and
// /api/watchtower/patrol.

async function assertProject(projectId: string, userId: string) {
  const project = await getProjectByIdForUser(projectId, userId);
  if (!project) {
    throw new ChatbotError("not_found:chat", "Project not found");
  }
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const projectId = new URL(request.url).searchParams.get("project_id");
    if (!projectId) {
      return new ChatbotError(
        "bad_request:api",
        "project_id is required"
      ).toResponse();
    }
    await assertProject(projectId, session.user.id);

    try {
      const [watches, settings] = await Promise.all([
        listWatchesByProject(projectId),
        getProjectAgentSettings(projectId),
      ]);
      return Response.json({ watches, settings, not_migrated: false });
    } catch (error) {
      if (error instanceof IRNotReadyError) {
        // Pre-migration database — the UI still renders, with patrols
        // marked unavailable instead of a 503.
        return Response.json({
          watches: [],
          settings: DEFAULT_AGENT_SETTINGS,
          not_migrated: true,
        });
      }
      throw error;
    }
  } catch (error) {
    return irErrorToResponse(error, "Failed to load watches");
  }
}

const createSchema = z.object({
  node_id: z.string().min(1),
  cadence: z.enum(PATROL_CADENCES).optional(),
  model_id: z.string().nullish(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = createSchema.parse(await request.json());
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

    const existing = await findWatchByNodeId(node.id);
    if (existing) {
      return Response.json({ watch: existing }, { status: 200 });
    }

    const settings = await getProjectAgentSettings(node.projectId);
    const watch = await createWatch({
      projectId: node.projectId,
      nodeId: node.id,
      origin: "user_requested",
      reason: "用户要求关注此节点",
      cadence: body.cadence ?? settings.defaultCadence,
      modelId: body.model_id ?? null,
    });
    return Response.json({ watch }, { status: 201 });
  } catch (error) {
    return irErrorToResponse(error, "Failed to create watch");
  }
}

const patchSchema = z.object({
  // Watch updates
  watch_id: z.string().uuid().optional(),
  cadence: z.enum(PATROL_CADENCES).optional(),
  status: z.enum(["active", "paused"]).optional(),
  model_id: z.string().nullish(),
  // Project agent-settings updates
  project_id: z.string().uuid().optional(),
  patrol_enabled: z.boolean().optional(),
  default_cadence: z.enum(PATROL_CADENCES).optional(),
  research_model_id: z.string().nullish(),
});

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const body = patchSchema.parse(await request.json());

    if (body.watch_id) {
      const watch = await getWatchById(body.watch_id);
      if (!watch) {
        return new ChatbotError(
          "not_found:chat",
          "Watch not found"
        ).toResponse();
      }
      await assertProject(watch.projectId, session.user.id);
      await updateWatch({
        id: watch.id,
        ...(body.cadence && isPatrolCadence(body.cadence)
          ? { cadence: body.cadence }
          : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.model_id !== undefined ? { modelId: body.model_id } : {}),
      });
      const updated = await getWatchById(watch.id);
      return Response.json({ watch: updated });
    }

    if (body.project_id) {
      await assertProject(body.project_id, session.user.id);
      const settings = await updateProjectAgentSettings(body.project_id, {
        ...(body.patrol_enabled !== undefined
          ? { patrolEnabled: body.patrol_enabled }
          : {}),
        ...(body.default_cadence
          ? { defaultCadence: body.default_cadence }
          : {}),
        ...(body.research_model_id !== undefined
          ? { researchModelId: body.research_model_id }
          : {}),
      });
      return Response.json({ settings });
    }

    return new ChatbotError(
      "bad_request:api",
      "watch_id or project_id is required"
    ).toResponse();
  } catch (error) {
    return irErrorToResponse(error, "Failed to update watchtower settings");
  }
}
