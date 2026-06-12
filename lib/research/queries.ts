import "server-only";

import { ChatbotError } from "@/lib/errors";
import { IRNotReadyError } from "@/lib/ir/queries";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResearchRunStatus = "running" | "done" | "partial" | "failed";

export type ResearchRun = {
  id: string;
  projectId: string;
  topicId: string | null;
  originNodeId: string;
  plan: unknown;
  brief: string | null;
  status: ResearchRunStatus;
  error: string | null;
  budget: unknown;
  costEstimate: number | null;
  modelsUsed: unknown;
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

function mapResearchRun(row: Record<string, unknown>): ResearchRun {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    topicId: toNullableString(row.topic_id),
    originNodeId: String(row.origin_node_id),
    plan: row.plan,
    brief: toNullableString(row.brief),
    status: String(row.status) as ResearchRunStatus,
    error: toNullableString(row.error),
    budget: row.budget,
    costEstimate: toNullableNumber(row.cost_estimate),
    modelsUsed: row.models_used,
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
}: {
  projectId: string;
  topicId: string | null;
  originNodeId: string;
  budget: unknown;
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
  costEstimate,
  modelsUsed,
  finishedAt,
}: {
  id: string;
  plan?: unknown;
  brief?: string | null;
  status?: ResearchRunStatus;
  error?: string | null;
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
    retrieved_at: toIsoString(r.retrievedAt),
  }));

  const inserted = await ensureResult<Record<string, unknown>[]>(
    db.from("evidence").insert(snakeRows).select("*"),
    "Failed to insert evidence rows"
  );

  return inserted.map(mapEvidence);
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

  return rows.map(mapResearchRun);
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
