import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type CompactionCheckpoint = {
  conversationId: string;
  summary: string;
  compactedThroughMessageId: string;
  compactedThroughCreatedAt: string;
  summarizedMessageCount: number;
  summaryTokenEstimate: number;
};

type DatabaseRecord = Record<string, unknown>;

function getClient(): any {
  return getSupabaseAdminClient() as any;
}

function toIsoString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function mapCheckpoint(row: DatabaseRecord): CompactionCheckpoint {
  return {
    conversationId: String(row.conversation_id),
    summary: String(row.summary ?? ""),
    compactedThroughMessageId: String(row.compacted_through_message_id),
    compactedThroughCreatedAt: toIsoString(row.compacted_through_created_at),
    summarizedMessageCount: Number(row.summarized_message_count ?? 0),
    summaryTokenEstimate: Number(row.summary_token_estimate ?? 0),
  };
}

// Compaction must never break a chat turn: on any DB error we log and behave as
// if no checkpoint exists (i.e. fall back to sending the full history).
export async function getCompactionCheckpoint(
  conversationId: string
): Promise<CompactionCheckpoint | null> {
  try {
    const { data, error } = await getClient()
      .from("conversation_compaction")
      .select("*")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load compaction checkpoint", error);
      return null;
    }

    return data ? mapCheckpoint(data as DatabaseRecord) : null;
  } catch (error) {
    console.error("Failed to load compaction checkpoint", error);
    return null;
  }
}

export async function upsertCompactionCheckpoint(
  checkpoint: CompactionCheckpoint
): Promise<void> {
  try {
    const { error } = await getClient().from("conversation_compaction").upsert(
      {
        conversation_id: checkpoint.conversationId,
        summary: checkpoint.summary,
        compacted_through_message_id: checkpoint.compactedThroughMessageId,
        compacted_through_created_at: checkpoint.compactedThroughCreatedAt,
        summarized_message_count: checkpoint.summarizedMessageCount,
        summary_token_estimate: checkpoint.summaryTokenEstimate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id" }
    );

    if (error) {
      console.error("Failed to persist compaction checkpoint", error);
    }
  } catch (error) {
    console.error("Failed to persist compaction checkpoint", error);
  }
}
