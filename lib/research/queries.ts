import "server-only";

import { ChatbotError } from "@/lib/errors";
import { IRNotReadyError } from "@/lib/ir/queries";
import {
  ACTIVE_RUN_STATUSES,
  RUN_TYPES,
  type RunProgress,
  type RunStatus,
  type RunType,
  settlementForAbandonedRun,
} from "@/lib/research/run-progress-core";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The status/type vocabularies live in run-progress-core so the client can
// import them without pulling in this server-only module. These aliases keep
// the existing call sites reading naturally.
export type ResearchRunStatus = RunStatus;

// 'research' = user-triggered L2 run; 'patrol' = Watchtower L3 sentinel;
// 'sweep' = conversation extraction.
export type ResearchRunType = RunType;

export type ResearchRun = {
  id: string;
  projectId: string;
  topicId: string | null;
  // Null for sweeps, which extract from a conversation and have no origin node.
  originNodeId: string | null;
  plan: unknown;
  brief: string | null;
  status: ResearchRunStatus;
  error: string | null;
  budget: unknown;
  progress: RunProgress | null;
  costEstimate: number | null;
  modelsUsed: unknown;
  runType: ResearchRunType;
  watchId: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type EvidenceItem = {
  id: string;
  projectId: string;
  runId: string;
  nodeId: string;
  url: string;
  title: string | null;
  quote: string;
  claim: string;
  stance: "supports" | "contradicts" | "neutral";
  sourceScore: number | null;
  retrievedAt: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Module-internal helpers (mirrors lib/ir/queries.ts pattern)
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

function getClient(): any {
  return getSupabaseAdminClient() as any;
}

function isMissingTableError(error: DatabaseErrorLike | null | undefined) {
  return (
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table") === true ||
    error?.message?.includes("schema cache") === true
  );
}

async function ensureResult<T>(
  promise: PromiseLike<SupabaseResult<T>>,
  message: string
) {
  const { data, error } = await promise;

  if (error) {
    if (isMissingTableError(error)) {
      throw new IRNotReadyError("Research schema has not been migrated yet.");
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

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toRunType(value: unknown): ResearchRunType {
  // Rows predating the watchtower migration have no run_type column at all.
  return (RUN_TYPES as readonly string[]).includes(String(value))
    ? (value as ResearchRunType)
    : "research";
}

function toRunProgress(value: unknown): RunProgress | null {
  // The column may be absent (pre-migration) or hold anything jsonb allows.
  // A malformed checkpoint must degrade to "no checkpoint", never throw —
  // this is read on every poll of a live run.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.phase === "string"
    ? (candidate as unknown as RunProgress)
    : null;
}

function mapResearchRun(row: Record<string, unknown>): ResearchRun {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    topicId: toNullableString(row.topic_id),
    originNodeId: toNullableString(row.origin_node_id),
    plan: row.plan,
    brief: toNullableString(row.brief),
    status: String(row.status) as ResearchRunStatus,
    error: toNullableString(row.error),
    budget: row.budget,
    progress: toRunProgress(row.progress),
    costEstimate: toNullableNumber(row.cost_estimate),
    modelsUsed: row.models_used,
    runType: toRunType(row.run_type),
    watchId: toNullableString(row.watch_id),
    createdAt: toIsoString(row.created_at),
    finishedAt: row.finished_at == null ? null : toIsoString(row.finished_at),
  };
}

function mapEvidence(row: Record<string, unknown>): EvidenceItem {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    runId: String(row.run_id),
    nodeId: String(row.node_id),
    url: String(row.url),
    title: toNullableString(row.title),
    quote: String(row.quote),
    claim: String(row.claim),
    stance: String(row.stance) as EvidenceItem["stance"],
    sourceScore: toNullableNumber(row.source_score),
    retrievedAt: toIsoString(row.retrieved_at),
    createdAt: toIsoString(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createResearchRun({
  projectId,
  topicId,
  originNodeId,
  budget,
  runType,
  watchId,
}: {
  projectId: string;
  topicId: string | null;
  originNodeId: string | null;
  budget: unknown;
  runType?: ResearchRunType;
  watchId?: string | null;
}): Promise<ResearchRun> {
  const db = getClient();

  const row = await ensureResult<Record<string, unknown>>(
    db
      .from("research_run")
      .insert({
        project_id: projectId,
        topic_id: topicId,
        origin_node_id: originNodeId,
        budget,
        // Omit patrol columns entirely on default runs so inserts keep
        // working against a pre-watchtower-migration database.
        ...(runType && runType !== "research" ? { run_type: runType } : {}),
        ...(watchId ? { watch_id: watchId } : {}),
      })
      .select("*")
      .single(),
    "Failed to create research run"
  );

  return mapResearchRun(row);
}

export async function updateResearchRun({
  id,
  plan,
  brief,
  status,
  error,
  progress,
  costEstimate,
  modelsUsed,
  finishedAt,
}: {
  id: string;
  plan?: unknown;
  brief?: string | null;
  status?: ResearchRunStatus;
  error?: string | null;
  progress?: RunProgress | null;
  costEstimate?: number | null;
  modelsUsed?: unknown;
  finishedAt?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = {};

  if (plan !== undefined) {
    patch.plan = plan;
  }
  if (brief !== undefined) {
    patch.brief = brief;
  }
  if (status !== undefined) {
    patch.status = status;
  }
  if (error !== undefined) {
    patch.error = error;
  }
  if (progress !== undefined) {
    patch.progress = progress;
  }
  if (costEstimate !== undefined) {
    patch.cost_estimate = costEstimate;
  }
  if (modelsUsed !== undefined) {
    patch.models_used = modelsUsed;
  }
  if (finishedAt !== undefined) {
    patch.finished_at = finishedAt;
  }

  if (Object.keys(patch).length === 0) {
    return;
  }

  const db = getClient();

  await ensureResult<unknown>(
    db.from("research_run").update(patch).eq("id", id),
    "Failed to update research run"
  );
}

export async function insertEvidence(
  rows: Omit<EvidenceItem, "id" | "createdAt">[]
): Promise<EvidenceItem[]> {
  if (rows.length === 0) {
    return [];
  }

  const db = getClient();

  const snakeRows = rows.map((r) => ({
    project_id: r.projectId,
    run_id: r.runId,
    node_id: r.nodeId,
    url: r.url,
    title: r.title,
    quote: r.quote,
    claim: r.claim,
    stance: r.stance,
    source_score: r.sourceScore,
    retrieved_at: toIsoString(r.retrievedAt),
  }));

  // Deploy-order tolerance: if the source_score column has not been migrated
  // yet (PostgREST PGRST204 "column not found"), land the evidence without
  // scores rather than failing the whole run.
  const first = await db.from("evidence").insert(snakeRows).select("*");
  if (
    first.error?.code === "PGRST204" &&
    first.error.message?.includes("source_score")
  ) {
    const legacyRows = snakeRows.map(
      ({ source_score: _sourceScore, ...rest }) => rest
    );
    const inserted = await ensureResult<Record<string, unknown>[]>(
      db.from("evidence").insert(legacyRows).select("*"),
      "Failed to insert evidence rows"
    );
    return inserted.map(mapEvidence);
  }

  if (first.error) {
    if (isMissingTableError(first.error)) {
      throw new IRNotReadyError("Research schema has not been migrated yet.");
    }
    console.error("Failed to insert evidence rows", {
      code: first.error.code ?? null,
      message: first.error.message,
      details: first.error.details ?? null,
      hint: first.error.hint ?? null,
    });
    throw new ChatbotError(
      "bad_request:database",
      "Failed to insert evidence rows"
    );
  }

  return (first.data as Record<string, unknown>[]).map(mapEvidence);
}

/**
 * Close out any run in this batch whose invocation is provably gone.
 *
 * Reaping happens on read rather than on a schedule, and that is the point:
 * the moment anyone asks what this project is doing is exactly the moment a
 * dead row starts lying to them. A cron would be the conventional answer, but
 * this deployment's cron budget is one daily job — a run could sit `running`
 * for twenty hours before anything looked at it, and the person waiting on it
 * would be looking long before that.
 *
 * It takes the rows the caller already fetched instead of running its own
 * query, so a listing that finds nothing abandoned costs exactly nothing
 * extra. Each write is a compare-and-swap on the status we read, so a run that
 * finished honestly in the microseconds between the read and the write keeps
 * its own verdict rather than ours. And it never throws: this runs inside the
 * poll that draws the activity bar, and failing to bury a dead run is not a
 * reason to stop reporting the live ones.
 */
async function settleAbandonedRuns(
  runs: ResearchRun[]
): Promise<ResearchRun[]> {
  const nowMs = Date.now();
  const finishedAt = new Date(nowMs).toISOString();

  const abandoned = runs.flatMap((run) => {
    const settlement = settlementForAbandonedRun(run, nowMs);
    return settlement ? [{ run, settlement }] : [];
  });

  if (abandoned.length === 0) {
    return runs;
  }

  const db = getClient();
  const settled = new Map<
    string,
    { status: RunStatus; error: string | null }
  >();

  await Promise.all(
    abandoned.map(async ({ run, settlement }) => {
      try {
        const { error } = await db
          .from("research_run")
          .update({
            status: settlement.status,
            error: settlement.error,
            finished_at: finishedAt,
          })
          .eq("id", run.id)
          // Compare-and-swap: only bury the run we actually read.
          .eq("status", run.status);

        if (error) {
          console.warn("Abandoned run not settled", {
            runId: run.id,
            code: error.code ?? null,
            message: error.message,
          });
          return;
        }

        settled.set(run.id, settlement);
      } catch (cause) {
        console.warn("Abandoned run not settled", { runId: run.id, cause });
      }
    })
  );

  if (settled.size === 0) {
    return runs;
  }

  return runs.map((run) => {
    const settlement = settled.get(run.id);
    return settlement
      ? {
          ...run,
          status: settlement.status,
          error: settlement.error,
          finishedAt,
        }
      : run;
  });
}

export async function listResearchRunsForNode({
  nodeId,
  limit = 10,
}: {
  nodeId: string;
  limit?: number;
}): Promise<ResearchRun[]> {
  const db = getClient();

  const rows = await ensureResult<Record<string, unknown>[]>(
    db
      .from("research_run")
      .select("*")
      .eq("origin_node_id", nodeId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Failed to list research runs for node"
  );

  return settleAbandonedRuns(rows.map(mapResearchRun));
}

/**
 * Write an in-flight checkpoint and read back the run's current status.
 *
 * One round trip does both jobs on purpose. The status it returns is how the
 * pipeline learns it has been cancelled, and cancellation is only responsive
 * if it is checked as often as progress is written — checking only at phase
 * boundaries would leave a user waiting out the whole collect phase.
 *
 * Deliberately never throws. A checkpoint is a progress report, not a result:
 * if the column is missing because the migration has not run yet, or the write
 * times out, the run must carry on. Losing the bar is annoying; losing a
 * four-minute research run because its progress bar could not be updated is
 * indefensible. Callers are on the hot path and must not have to guard.
 */
export async function writeRunCheckpoint({
  id,
  progress,
}: {
  id: string;
  progress: RunProgress;
}): Promise<ResearchRunStatus | null> {
  try {
    const db = getClient();
    const { data, error } = await db
      .from("research_run")
      .update({ progress: { ...progress, at: progress.at ?? nowIso() } })
      .eq("id", id)
      .select("status")
      .maybeSingle();

    if (error) {
      console.warn("Run checkpoint skipped", {
        runId: id,
        code: error.code ?? null,
        message: error.message,
      });
      return null;
    }

    return data
      ? (String((data as Record<string, unknown>).status) as ResearchRunStatus)
      : null;
  } catch (cause) {
    console.warn("Run checkpoint skipped", { runId: id, cause });
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

export type RunActivityRow = ResearchRun & { label: string | null };

/**
 * Every run this project has going, plus whatever finished recently.
 *
 * This is the query the activity bar is built on, and it is the one thing the
 * schema never had: runs could only be listed per origin node, so "what is
 * this project doing right now" was unanswerable — which is why a nightly
 * patrol had nowhere to land in the UI.
 */
export async function listProjectRunActivity({
  projectId,
  sinceIso,
  limit = 20,
}: {
  projectId: string;
  sinceIso?: string;
  limit?: number;
}): Promise<RunActivityRow[]> {
  const db = getClient();

  let query = db
    .from("research_run")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sinceIso) {
    // Active runs must survive the window: a run started before the cutoff and
    // still going is exactly the one the user needs to see.
    const activeClause = ACTIVE_RUN_STATUSES.map(
      (status) => `status.eq.${status}`
    ).join(",");
    query = query.or(`created_at.gte.${sinceIso},${activeClause}`);
  }

  const rows = await ensureResult<Record<string, unknown>[]>(
    query,
    "Failed to list project run activity"
  );

  const runs = await settleAbandonedRuns(rows.map(mapResearchRun));
  const nodeIds = [
    ...new Set(
      runs
        .map((run) => run.originNodeId)
        .filter((nodeId): nodeId is string => Boolean(nodeId))
    ),
  ];

  const titles = new Map<string, string>();
  if (nodeIds.length > 0) {
    // A separate lookup rather than a PostgREST embed: the label is cosmetic,
    // and a failed embed must not take the run list down with it.
    const { data, error } = await db
      .from("ir_nodes")
      .select("id,title")
      .in("id", nodeIds);

    if (error) {
      console.warn("Run activity labels unavailable", {
        code: error.code ?? null,
        message: error.message,
      });
    } else {
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        titles.set(String(row.id), String(row.title ?? ""));
      }
    }
  }

  return runs.map((run) => ({
    ...run,
    label: run.originNodeId ? (titles.get(run.originNodeId) ?? null) : null,
  }));
}

/**
 * The cheap read the pipeline does at a phase boundary to see whether the user
 * asked it to stop. Returns null when the row is gone.
 */
export async function getResearchRunStatus({
  id,
}: {
  id: string;
}): Promise<ResearchRunStatus | null> {
  try {
    const db = getClient();
    const { data, error } = await db
      .from("research_run")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return String(
      (data as Record<string, unknown>).status
    ) as ResearchRunStatus;
  } catch {
    // Same reasoning as the checkpoint: an unreadable cancel flag means "not
    // cancelled", never "abort the run".
    return null;
  }
}

/**
 * Ask a run to stop at its next phase boundary.
 *
 * Deliberately not a hard abort. The pipeline reads this between phases, so
 * the worst case is that the user waits out one in-flight fetch — and in
 * exchange there is no half-written run state to clean up. Scoped by project
 * so a run id alone is not authority to cancel it.
 */
export async function requestRunCancellation({
  id,
  projectId,
}: {
  id: string;
  projectId: string;
}): Promise<ResearchRun | null> {
  const db = getClient();

  const rows = await ensureResult<Record<string, unknown>[]>(
    db
      .from("research_run")
      .update({ status: "cancelling" })
      .eq("id", id)
      .eq("project_id", projectId)
      .in("status", [...ACTIVE_RUN_STATUSES])
      .select("*"),
    "Failed to request run cancellation"
  );

  const row = rows.at(0);
  return row ? mapResearchRun(row) : null;
}

/**
 * What this project's comparable runs have actually cost.
 *
 * Feeds the pre-run anchor. Only finished runs count, and only ones of the
 * same type — a sweep and a four-phase research run are not comparable, and
 * quoting one for the other would be a made-up number wearing a measurement's
 * clothes.
 */
export async function listRecentRunCosts({
  projectId,
  runType,
  limit = 10,
}: {
  projectId: string;
  runType: ResearchRunType;
  limit?: number;
}): Promise<number[]> {
  try {
    const db = getClient();
    const { data, error } = await db
      .from("research_run")
      .select("cost_estimate,run_type,status")
      .eq("project_id", projectId)
      .in("status", ["done", "partial"])
      .order("created_at", { ascending: false })
      .limit(limit * 3);

    if (error) {
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[])
      .filter((row) => toRunType(row.run_type) === runType)
      .map((row) => toNullableNumber(row.cost_estimate))
      .filter((cost): cost is number => typeof cost === "number" && cost > 0)
      .slice(0, limit);
  } catch {
    // No history is a legitimate answer here; the caller shows nothing rather
    // than a placeholder.
    return [];
  }
}

export async function listEvidenceForNode({
  nodeId,
  limit = 50,
}: {
  nodeId: string;
  limit?: number;
}): Promise<EvidenceItem[]> {
  const db = getClient();

  const rows = await ensureResult<Record<string, unknown>[]>(
    db
      .from("evidence")
      .select("*")
      .eq("node_id", nodeId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Failed to list evidence for node"
  );

  return rows.map(mapEvidence);
}
