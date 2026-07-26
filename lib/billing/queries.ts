import "server-only";

import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  computeCostEstimate,
  type ModelsUsedAccumulator,
  meterCostUsd,
} from "./cost-core";
import {
  byokAad,
  decryptSecret,
  encryptSecret,
  keyHint,
  resolveByokSecret,
} from "./crypto";
import { billingPeriodKey } from "./plan-core";

// ---------------------------------------------------------------------------
// Client plumbing (mirrors lib/research/watch-queries.ts)
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
    error?.code === "PGRST202" ||
    error?.code === "42703" ||
    error?.message?.includes("Could not find the table") === true ||
    error?.message?.includes("schema cache") === true
  );
}

/**
 * Thrown when the billing tables are not migrated yet.
 *
 * Callers must treat this as "billing is unavailable", never as "this user has
 * spent nothing". The difference matters: the second reading turns a missing
 * migration into an unlimited free tier.
 */
export class BillingNotReadyError extends Error {}

async function ensureResult<T>(
  promise: PromiseLike<SupabaseResult<T>>,
  message: string
) {
  const { data, error } = await promise;
  if (error) {
    if (isMissingTableError(error)) {
      throw new BillingNotReadyError(
        "Billing schema has not been migrated yet."
      );
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

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type UsageKind =
  | "chat"
  | "research"
  | "patrol"
  | "sweep"
  | "kickoff"
  | "search"
  | "import";
export type LedgerFundingSource = "platform" | "byok";

/**
 * Record what a call actually spent.
 *
 * The metering happens here rather than at the call site so that there is
 * exactly one place where `meterCostUsd` and `computeCostEstimate` are chosen
 * between. Callers hand over the raw accumulator; they cannot accidentally
 * charge the allowance the reporting number (which is null for unpriced
 * models, i.e. free).
 *
 * Never throws to the caller. A failed ledger write must not fail the user's
 * request that already succeeded — the work is done and the tokens are spent
 * either way, and turning a bookkeeping outage into a product outage is a
 * worse trade than under-counting a few calls. It is logged loudly instead.
 */
export async function recordUsage({
  userId,
  projectId,
  runId,
  kind,
  fundingSource,
  modelsUsed,
  now = new Date(),
}: {
  userId: string;
  projectId?: string | null;
  runId?: string | null;
  kind: UsageKind;
  fundingSource: LedgerFundingSource;
  modelsUsed: ModelsUsedAccumulator;
  now?: Date;
}): Promise<void> {
  const metered = meterCostUsd(modelsUsed);
  const estimate = computeCostEstimate(modelsUsed);

  let inputTokens = 0;
  let outputTokens = 0;
  for (const usage of Object.values(modelsUsed)) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
  }

  // A call that spent nothing measurable still happened, but a row of zeroes
  // adds nothing to any sum and costs an insert on every no-op path.
  if (metered.usd <= 0 && inputTokens === 0 && outputTokens === 0) {
    return;
  }

  try {
    const db = getClient();
    const { error } = await db.from("usage_ledger").insert({
      user_id: userId,
      project_id: projectId ?? null,
      run_id: runId ?? null,
      kind,
      funding_source: fundingSource,
      billing_period: billingPeriodKey(now),
      models_used: modelsUsed,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      metered_usd: metered.usd.toFixed(6),
      estimate_usd: estimate === null ? null : estimate.toFixed(6),
      is_estimated: metered.estimatedKeys.length > 0,
    });
    if (error) {
      console.error("Failed to write usage ledger row", {
        code: error.code ?? null,
        message: error.message,
        userId,
        kind,
      });
    }
  } catch (error) {
    console.error("Failed to write usage ledger row", error);
  }
}

/**
 * This user's platform-funded spend in the current billing period, USD.
 *
 * BYOK rows are summed in too. They are charged to the user's own key, so they
 * do not draw down the allowance — but `decideFunding` never looks at the
 * number for a key holder, and keeping the sum total-honest means the settings
 * page can show "you have spent $X this month" without a second query that
 * disagrees with this one.
 */
export async function getMonthlySpendUsd(
  userId: string,
  now: Date = new Date()
): Promise<number> {
  const db = getClient();
  const value = await ensureResult<unknown>(
    db.rpc("usage_spend_usd", {
      target_user: userId,
      period: billingPeriodKey(now),
    }),
    "Failed to read monthly spend"
  );
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Platform-funded spend only — what the free allowance actually meters. */
export async function getPlatformSpendUsd(
  userId: string,
  now: Date = new Date()
): Promise<number> {
  const db = getClient();
  const rows = await ensureResult<{ metered_usd: string | number }[]>(
    db
      .from("usage_ledger")
      .select("metered_usd")
      .eq("user_id", userId)
      .eq("billing_period", billingPeriodKey(now))
      .eq("funding_source", "platform")
      .limit(1000),
    "Failed to read platform spend"
  );

  // The 1000-row cap is PostgREST's, not a choice. It is survivable here only
  // because a user who has generated 1000 platform-funded rows in one month
  // has long since blown through a $2 allowance — the sum is already far past
  // the threshold, so a truncated sum reaches the same decision. If the
  // allowance ever grows past that reasoning, this needs its own RPC.
  let total = 0;
  for (const row of rows ?? []) {
    const value = Number(row.metered_usd ?? 0);
    if (Number.isFinite(value)) {
      total += value;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Provider keys
// ---------------------------------------------------------------------------

export const BYOK_PROVIDERS = [
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "dashscope",
  "gateway",
  "tavily",
] as const;
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

export function isByokProvider(value: string): value is ByokProvider {
  return (BYOK_PROVIDERS as readonly string[]).includes(value);
}

/** What the settings UI is allowed to see. Never the ciphertext. */
export type ProviderKeySummary = {
  provider: ByokProvider;
  keyHint: string;
  label: string | null;
  status: "active" | "invalid";
  lastError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

const SUMMARY_COLUMNS =
  "provider, key_hint, label, status, last_error, last_used_at, created_at";

function mapSummary(row: Record<string, unknown>): ProviderKeySummary {
  return {
    provider: String(row.provider) as ByokProvider,
    keyHint: String(row.key_hint ?? ""),
    label: typeof row.label === "string" ? row.label : null,
    status: row.status === "invalid" ? "invalid" : "active",
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    createdAt: String(row.created_at),
  };
}

export async function listProviderKeys(
  userId: string
): Promise<ProviderKeySummary[]> {
  const rows = await ensureResult<Record<string, unknown>[]>(
    getClient()
      .from("provider_keys")
      .select(SUMMARY_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    "Failed to list provider keys"
  );
  return (rows ?? []).map(mapSummary);
}

/**
 * Store or replace one key.
 *
 * Upsert on (user_id, provider) rather than insert-a-new-row: two live keys
 * for one provider would mean the system picks one and the user cannot tell
 * which, and "which of my keys is being billed" is not a question a product
 * should make anyone guess at.
 */
export async function saveProviderKey({
  userId,
  provider,
  apiKey,
  label,
}: {
  userId: string;
  provider: ByokProvider;
  apiKey: string;
  label?: string | null;
}): Promise<ProviderKeySummary> {
  const secret = resolveByokSecret();
  if (!secret) {
    // Refusing is the only safe answer. Storing plaintext "for now" is how a
    // vault becomes a leak, and there is no way to tell the user later that
    // the key they pasted last month was never encrypted.
    throw new ChatbotError(
      "bad_request:api",
      "Key storage is not configured on this deployment (ZENO_BYOK_SECRET)."
    );
  }

  const trimmed = apiKey.trim();
  const row = await ensureResult<Record<string, unknown>>(
    getClient()
      .from("provider_keys")
      .upsert(
        {
          user_id: userId,
          provider,
          ciphertext: encryptSecret({
            plaintext: trimmed,
            aad: byokAad(userId, provider),
            secret,
          }),
          key_hint: keyHint(trimmed),
          label: label ?? null,
          // A newly pasted key is active by definition; carrying over a stale
          // 'invalid' would leave the user staring at an error they just fixed.
          status: "active",
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" }
      )
      .select(SUMMARY_COLUMNS)
      .single(),
    "Failed to save provider key"
  );
  return mapSummary(row);
}

export async function deleteProviderKey({
  userId,
  provider,
}: {
  userId: string;
  provider: ByokProvider;
}): Promise<void> {
  await ensureResult(
    getClient()
      .from("provider_keys")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider),
    "Failed to delete provider key"
  );
}

/**
 * Which providers this user has a usable key for.
 *
 * Deliberately excludes `status = 'invalid'`, so a dead key stops routing and
 * the user falls back to the platform allowance — visibly, because the
 * settings page shows the invalid state and `last_error`.
 */
export async function getActiveKeyProviders(
  userId: string
): Promise<Set<ByokProvider>> {
  const rows = await ensureResult<{ provider: string }[]>(
    getClient()
      .from("provider_keys")
      .select("provider")
      .eq("user_id", userId)
      .eq("status", "active"),
    "Failed to read provider keys"
  );
  const providers = new Set<ByokProvider>();
  for (const row of rows ?? []) {
    if (isByokProvider(row.provider)) {
      providers.add(row.provider);
    }
  }
  return providers;
}

/**
 * Decrypt one key for use. Server-side only, and the result must never be
 * returned to a client or written to a log.
 *
 * Returns null rather than throwing when there is no usable key, because the
 * caller's next move is the same either way: fall back to platform funding.
 * A decryption *failure* is different — that means a row exists and cannot be
 * read, which is a state the user has to be told about — so it marks the row
 * invalid on the way out.
 */
export async function getProviderApiKey({
  userId,
  provider,
}: {
  userId: string;
  provider: ByokProvider;
}): Promise<string | null> {
  const secret = resolveByokSecret();
  if (!secret) {
    return null;
  }

  const rows = await ensureResult<{ ciphertext: string }[]>(
    getClient()
      .from("provider_keys")
      .select("ciphertext")
      .eq("user_id", userId)
      .eq("provider", provider)
      .eq("status", "active")
      .limit(1),
    "Failed to read provider key"
  );
  const ciphertext = rows?.[0]?.ciphertext;
  if (!ciphertext) {
    return null;
  }

  try {
    return decryptSecret({
      payload: ciphertext,
      aad: byokAad(userId, provider),
      secret,
    });
  } catch {
    await markProviderKeyInvalid({
      userId,
      provider,
      reason:
        "Stored key could not be decrypted. Re-paste it to restore your own billing.",
    });
    return null;
  }
}

/**
 * Mark a key unusable and say why.
 *
 * This is the Iron Law 2 hook for money: the alternative — quietly routing
 * back to the platform allowance when a user's key starts returning 401 — is a
 * silent miss, and the user finds out when the free tier they were not using
 * is suddenly gone.
 */
export async function markProviderKeyInvalid({
  userId,
  provider,
  reason,
}: {
  userId: string;
  provider: ByokProvider;
  reason: string;
}): Promise<void> {
  try {
    await getClient()
      .from("provider_keys")
      .update({
        status: "invalid",
        last_error: reason.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("provider", provider);
  } catch (error) {
    console.error("Failed to mark provider key invalid", error);
  }
}

export async function touchProviderKeyUsed({
  userId,
  provider,
}: {
  userId: string;
  provider: ByokProvider;
}): Promise<void> {
  try {
    await getClient()
      .from("provider_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("provider", provider);
  } catch {
    // Cosmetic timestamp; never worth failing a request over.
  }
}
