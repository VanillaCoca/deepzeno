import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { getIRNodeForUser, IRNotReadyError } from "@/lib/ir/queries";
import {
  DEFAULT_AGENT_SETTINGS,
  isPatrolCadence,
  PATROL_CADENCES,
  type PatrolCadence,
} from "@/lib/research/agent-settings";
import {
  computeNextDueAt,
  resolvePatrolBudget,
} from "@/lib/research/patrol-core";
import { summarizePatrolQueue } from "@/lib/research/patrol-queue-core";
import {
  admitNewWatch,
  watchQuotaMessage,
} from "@/lib/research/watch-admission";
import {
  countPatrolQueue,
  createWatch,
  findWatchByNodeId,
  getProjectAgentSettings,
  getWatchById,
  listWatchesByProject,
  measureSweepCapacity,
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
      const budget = resolvePatrolBudget();
      const [watches, settings, queue, admission, capacity] = await Promise.all(
        [
          listWatchesByProject(projectId),
          getProjectAgentSettings(projectId),
          countPatrolQueue(),
          admitNewWatch(session.user.id),
          measureSweepCapacity(budget),
        ]
      );
      // The measured throughput, not `maxWatchesPerSweep × sweepsPerDay`. This
      // is the number the user reads: it becomes "Zeno reaches this about every
      // N days" in the UI. Deriving it from the budget made that sentence
      // understate the wait by a factor of three — the product quietly
      // reassuring people about the one thing they asked it to promise.
      const health = summarizePatrolQueue({
        activeWatches: queue.active,
        dueNow: queue.due,
        dailyCapacity: capacity.perDay,
      });
      return Response.json({
        watches,
        settings,
        // Sent on every load, not only on refusal. The quota's other half is
        // enforced inside the research pipeline, where nobody is watching:
        // Zeno stops proposing watches at the cap and there is no request to
        // return an error to. A counter that is always visible explains those
        // refusals before they happen, which is the only form of "not silent"
        // available when the decision happens offline.
        quota: {
          active: admission.activeWatches,
          limit: admission.quota,
          admitted: admission.admitted,
        },
        // Only the derived cycle length crosses the boundary. The counts behind
        // it are a census of every project's watches, which is not this
        // project's business — but the wait it causes very much is, because
        // there is one cron and this project's watches queue behind all of
        // them. Null means the queue is keeping up and the cadence is real.
        queue: { realized_cycle_days: health.realizedCycleDays },
        not_migrated: false,
      });
    } catch (error) {
      if (error instanceof IRNotReadyError) {
        // Pre-migration database — the UI still renders, with patrols
        // marked unavailable instead of a 503.
        return Response.json({
          watches: [],
          settings: DEFAULT_AGENT_SETTINGS,
          queue: { realized_cycle_days: null },
          quota: null,
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

    // After the idempotency check on purpose: re-requesting a watch that
    // already exists consumes no new slot, and refusing it at the cap would
    // make a no-op look like a failure.
    const admission = await admitNewWatch(session.user.id);
    if (!admission.admitted) {
      return new ChatbotError(
        "payment_required:watch_quota",
        watchQuotaMessage(admission)
      ).toResponse();
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

/**
 * Picking a cadence clears the quiet-patrol backoff.
 *
 * The backoff is the system's inference from silence; the select is a human
 * saying how often they want this looked at. An inference does not get to
 * outrank the thing it was inferring about, and without this there would be no
 * way at all to overrule it — re-picking the same value would appear to do
 * nothing, which is worse than not offering the control.
 *
 * `next_due_at` has to move too. Resetting the counter while a 16-day wait is
 * still on the clock means the user's action takes effect in sixteen days,
 * which reads as "the button is broken". Recomputed from the last patrol, so
 * a watch already overdue under the new cadence becomes due now rather than
 * earning a fresh full interval. Left alone when there is no last patrol: such
 * a watch is due immediately by default, and recomputing would push it away.
 */
function resetBackoff(
  watch: { quietPatrols: number; lastPatrolAt: string | null },
  cadence: PatrolCadence
) {
  if (watch.quietPatrols === 0) {
    return {};
  }
  return {
    quietPatrols: 0,
    ...(watch.lastPatrolAt
      ? {
          nextDueAt: computeNextDueAt(
            cadence,
            new Date(watch.lastPatrolAt)
          ).toISOString(),
        }
      : {}),
  };
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
      const cadence =
        body.cadence && isPatrolCadence(body.cadence) ? body.cadence : null;
      await updateWatch({
        id: watch.id,
        ...(cadence ? { cadence, ...resetBackoff(watch, cadence) } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.model_id === undefined ? {} : { modelId: body.model_id }),
      });
      const updated = await getWatchById(watch.id);
      return Response.json({ watch: updated });
    }

    if (body.project_id) {
      await assertProject(body.project_id, session.user.id);
      const settings = await updateProjectAgentSettings(body.project_id, {
        ...(body.patrol_enabled === undefined
          ? {}
          : { patrolEnabled: body.patrol_enabled }),
        ...(body.default_cadence
          ? { defaultCadence: body.default_cadence }
          : {}),
        ...(body.research_model_id === undefined
          ? {}
          : { researchModelId: body.research_model_id }),
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
