import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceApiKey } from "@/lib/workspace/types";

type DatabaseRecord = Record<string, unknown>;

type AuthenticatedApiKey = WorkspaceApiKey & {
  keyHash: string;
};

function getClient() {
  return getSupabaseAdminClient() as any;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken() {
  return `zn_${randomBytes(16).toString("hex")}`;
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
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

function mapApiKey(row: DatabaseRecord): WorkspaceApiKey {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    keyPrefix: String(row.key_prefix),
    label: toNullableString(row.label),
    lastUsedAt: toNullableString(row.last_used_at),
    revokedAt: toNullableString(row.revoked_at),
    createdAt: toIsoString(row.created_at),
  };
}

function mapAuthenticatedApiKey(row: DatabaseRecord): AuthenticatedApiKey {
  return {
    ...mapApiKey(row),
    keyHash: String(row.key_hash),
  };
}

async function ensureOwnedProject(projectId: string, userId: string) {
  const client = getClient();
  const { data, error } = await client
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to verify project ownership", error);
    throw new ChatbotError("bad_request:database", "Failed to verify project");
  }

  if (!data) {
    throw new ChatbotError("forbidden:chat", "Project not found");
  }
}

export async function listProjectApiKeysForUser({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  await ensureOwnedProject(projectId, userId);

  const client = getClient();
  const { data, error } = await client
    .from("api_keys")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to list API keys", error);
    throw new ChatbotError("bad_request:database", "Failed to list API keys");
  }

  return ((data ?? []) as DatabaseRecord[]).map(mapApiKey);
}

export async function createProjectApiKeyForUser({
  projectId,
  userId,
  label,
}: {
  projectId: string;
  userId: string;
  label?: string | null;
}) {
  await ensureOwnedProject(projectId, userId);

  const token = generateToken();
  const keyHash = hashToken(token);
  const keyPrefix = token.slice(0, 11);
  const client = getClient();

  const { data, error } = await client
    .from("api_keys")
    .insert({
      user_id: userId,
      project_id: projectId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: label?.trim() ? label.trim() : null,
    })
    .select("*")
    .single();

  if (error) {
    console.error("Failed to create API key", error);
    throw new ChatbotError("bad_request:database", "Failed to create API key");
  }

  return {
    apiKey: mapApiKey(data as DatabaseRecord),
    token,
  };
}

export async function revokeProjectApiKeyForUser({
  keyId,
  projectId,
  userId,
}: {
  keyId: string;
  projectId: string;
  userId: string;
}) {
  await ensureOwnedProject(projectId, userId);

  const client = getClient();
  const { data, error } = await client
    .from("api_keys")
    .update({
      revoked_at: new Date().toISOString(),
    })
    .eq("id", keyId)
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Failed to revoke API key", error);
    throw new ChatbotError("bad_request:database", "Failed to revoke API key");
  }

  if (!data) {
    throw new ChatbotError("not_found:chat", "API key not found");
  }

  return mapApiKey(data as DatabaseRecord);
}

export async function authenticateProjectApiKey(token: string) {
  const client = getClient();
  const { data, error } = await client
    .from("api_keys")
    .select("*")
    .eq("key_hash", hashToken(token))
    .maybeSingle();

  if (error) {
    console.error("Failed to authenticate API key", error);
    throw new ChatbotError(
      "bad_request:database",
      "Failed to authenticate API key"
    );
  }

  if (!data) {
    return null;
  }

  const apiKey = mapAuthenticatedApiKey(data as DatabaseRecord);

  if (apiKey.revokedAt) {
    return null;
  }

  await client
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id);

  return apiKey;
}
