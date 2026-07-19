import "server-only";

import { ChatbotError } from "@/lib/errors";
import { IRNotReadyError } from "@/lib/ir/queries";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  type AgentSettings,
  type PatrolCadence,
  parseAgentSettings,
} from "./agent-settings";

// ---------------------------------------------------------------------------
// Types (pure module — importable from client components too)
// ---------------------------------------------------------------------------

import {
  type ExplorationDirection,
  type IRWatch,
  isExplorationDirectionArray,
  type WatchOrigin,
  type WatchStatus,
} from "./watch-types";

export type {
  ExplorationDirection,
  IRWatch,
  WatchOrigin,
  WatchStatus,
} from "./watch-types";

// ---------------------------------------------------------------------------
// Module-internal helpers (mirrors lib/research/queries.ts pattern)
// ---------------------------------------------------------------------------

type DatabaseErrorLike = {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
};

type SupabaseResult<T = unknown> = {
  data: T;
  error: DatabaseErrorLike | null;
};

// biome-ignore lint/suspicious/noExplicitAny: the admin client is untyped here, matching lib/research/queries.ts.
function getClient(): any {
  return getSupabaseAdminClient() as any;
}

function isMissingTableError(error: DatabaseErrorLike | null | undefined) {
  return (
    error?.code === "PGRST205" ||
    // 42703 = undefined column (agent_settings before the migration runs).
    error?.code === "42703" ||
    error?.message?.includes("Could not find the table") === true ||
    error?.message?.includes("schema cache") === true ||
    error?.message?.includes("does not exist") === true
  );
}

async function ensureResult<T>(
  promise: PromiseLike<SupabaseResult<T>>,
  message: string
) {
  const { data, error } = await promise;

  if (error) {
    if (isMissingTableError(error)) {
      throw new IRNotReadyError("Watchtower schema has not been migrated yet.");
    }

    console.error(message, {
      code: error.code ?? null,
      message: error.message,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
    throw new ChatbotError("bad_request:database", message);
  }

  return data;
}

function toIsoString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function toNullableIso(value: unknown) {
  return value == null ? null : toIsoString(value);
}

function mapWatch(row: Record<string, unknown>): IRWatch {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    nodeId: String(row.node_id),
    origin: String(row.origin) as WatchOrigin,
    reason: String(row.reason),
    cadence: String(row.cadence) as PatrolCadence,
    status: String(row.status) as WatchStatus,
    modelId: typeof row.model_id === "string" ? row.model_id : null,
    // Defensive parse: pre-migration rows have no column (undefined) and
    // hand-edited jsonb may be malformed — both collapse to null.
    nextDirections: isExplorationDirectionArray(row.next_directions)
      ? row.next_directions
      : null,
    lastPatrolAt: toNullableIso(row.last_patrol_at),
    lastSignalAt: toNullableIso(row.last_signal_at),
    lastAlertAt: toNullableIso(row.last_alert_at),
    nextDueAt: toIsoString(row.next_due_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Watches
// ---------------------------------------------------------------------------

export async function createWatch({
  projectId,
  nodeId,
  origin,
  reason,
  cadence,
  modelId,
  nextDueAt,
}: {
  projectId: string;
  nodeId: string;
  origin: WatchOrigin;
  reason: string;
  cadence: PatrolCadence;
  modelId?: string | null;
  nextDueAt?: string;
}): Promise<IRWatch> {
  const db = getClient();
  const row = await ensureResult<Record<string, unknown>>(
    db
      .from("ir_watches")
      .insert({
        project_id: projectId,
        node_id: nodeId,
        origin,
        reason,
        cadence,
        model_id: modelId ?? null,
        ...(nextDueAt ? { next_due_at: nextDueAt } : {}),
      })
      .select("*")
      .single(),
    "Failed to create watch"
  );
  return mapWatch(row);
}

export async function updateWatch({
  id,
  cadence,
  status,
  modelId,
  lastPatrolAt,
  lastSignalAt,
  lastAlertAt,
  nextDueAt,
  nextDirections,
}: {
  id: string;
  cadence?: PatrolCadence;
  status?: WatchStatus;
  modelId?: string | null;
  lastPatrolAt?: string;
  lastSignalAt?: string;
  lastAlertAt?: string;
  nextDueAt?: string;
  nextDirections?: ExplorationDirection[] | null;
}): Promise<void> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (cadence !== undefined) {
    patch.cadence = cadence;
  }
  if (status !== undefined) {
    patch.status = status;
  }
  if (modelId !== undefined) {
    patch.model_id = modelId;
  }
  if (lastPatrolAt !== undefined) {
    patch.last_patrol_at = lastPatrolAt;
  }
  if (lastSignalAt !== undefined) {
    patch.last_signal_at = lastSignalAt;
  }
  if (lastAlertAt !== undefined) {
    patch.last_alert_at = lastAlertAt;
  }
  if (nextDueAt !== undefined) {
    patch.next_due_at = nextDueAt;
  }
  if (nextDirections !== undefined) {
    patch.next_directions = nextDirections;
  }

  const db = getClient();
  await ensureResult(
    db.from("ir_watches").update(patch).eq("id", id),
    "Failed to update watch"
  );
}

export async function deleteWatch(id: string): Promise<void> {
  const db = getClient();
  await ensureResult(
    db.from("ir_watches").delete().eq("id", id),
    "Failed to delete watch"
  );
}

export async function getWatchById(id: string): Promise<IRWatch | null> {
  const db = getClient();
  const row = await ensureResult<Record<string, unknown> | null>(
    db.from("ir_watches").select("*").eq("id", id).maybeSingle(),
    "Failed to load watch"
  );
  return row ? mapWatch(row) : null;
}

export async function findWatchByNodeId(
  nodeId: string
): Promise<IRWatch | null> {
  const db = getClient();
  const row = await ensureResult<Record<string, unknown> | null>(
    db.from("ir_watches").select("*").eq("node_id", nodeId).maybeSingle(),
    "Failed to load watch by node"
  );
  return row ? mapWatch(row) : null;
}

export async function listWatchesByProject(
  projectId: string
): Promise<IRWatch[]> {
  const db = getClient();
  const rows = await ensureResult<Record<string, unknown>[]>(
    db
      .from("ir_watches")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    "Failed to list watches"
  );
  return (rows ?? []).map(mapWatch);
}

// Due watches across all projects, oldest due first — the cron sweep's
// natural continuation cursor (whatever a 300s invocation can't finish is
// first in line tomorrow).
export async function listDueWatches(limit: number): Promise<IRWatch[]> {
  const db = getClient();
  const rows = await ensureResult<Record<string, unknown>[]>(
    db
      .from("ir_watches")
      .select("*")
      .eq("status", "active")
      .lte("next_due_at", new Date().toISOString())
      .order("next_due_at", { ascending: true })
      .limit(limit),
    "Failed to list due watches"
  );
  return (rows ?? []).map(mapWatch);
}

// Weekly alert cap input: watchtower-sourced nodes created in this project
// over the trailing 7 days.
export async function countRecentWatchtowerAlerts(
  projectId: string
): Promise<number> {
  const db = getClient();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { count, error } = await db
    .from("ir_nodes")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("source_layer", "watchtower")
    .gte("created_at", since);
  if (error) {
    // Cap counting must never block a patrol; fail open at zero.
    console.error("Failed to count watchtower alerts", error);
    return 0;
  }
  return count ?? 0;
}

// Cron patrols run without a session; the project owner is the acting user
// for candidate creation (all access checks then pass by construction).
export async function getProjectOwnerId(
  projectId: string
): Promise<string | null> {
  const db = getClient();
  const row = await ensureResult<Record<string, unknown> | null>(
    db.from("projects").select("user_id").eq("id", projectId).maybeSingle(),
    "Failed to load project owner"
  );
  return row ? String(row.user_id) : null;
}

// ---------------------------------------------------------------------------
// Project agent settings
// ---------------------------------------------------------------------------

export async function getProjectAgentSettings(
  projectId: string
): Promise<AgentSettings> {
  const db = getClient();
  const row = await ensureResult<Record<string, unknown> | null>(
    db
      .from("projects")
      .select("agent_settings")
      .eq("id", projectId)
      .maybeSingle(),
    "Failed to load project agent settings"
  );
  return parseAgentSettings(row?.agent_settings ?? null);
}

export async function updateProjectAgentSettings(
  projectId: string,
  patch: Partial<AgentSettings>
): Promise<AgentSettings> {
  const current = await getProjectAgentSettings(projectId);
  const next: AgentSettings = { ...current, ...patch };
  const db = getClient();
  await ensureResult(
    db.from("projects").update({ agent_settings: next }).eq("id", projectId),
    "Failed to update project agent settings"
  );
  return next;
}
