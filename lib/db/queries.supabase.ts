import "server-only";

import type { VisibilityType } from "@/components/chat/visibility-selector";
import { ChatbotError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Chat, DBMessage, Stream, Vote } from "./schema";

type DatabaseRecord = Record<string, unknown>;

function toDate(value: unknown) {
  return value instanceof Date ? value : new Date(String(value));
}

function toRecords(value: unknown): DatabaseRecord[] {
  return Array.isArray(value) ? (value as DatabaseRecord[]) : [];
}

function mapChat(row: DatabaseRecord): Chat {
  return {
    id: String(row.id),
    createdAt: toDate(row.createdAt),
    title: String(row.title),
    userId: String(row.userId),
    visibility: row.visibility as Chat["visibility"],
  };
}

function mapMessage(row: DatabaseRecord): DBMessage {
  return {
    id: String(row.id),
    chatId: String(row.chatId),
    role: String(row.role),
    parts: row.parts as DBMessage["parts"],
    attachments: row.attachments as DBMessage["attachments"],
    createdAt: toDate(row.createdAt),
  };
}

function mapVote(row: DatabaseRecord): Vote {
  return {
    chatId: String(row.chatId),
    messageId: String(row.messageId),
    isUpvoted: Boolean(row.isUpvoted),
  };
}

function mapStream(row: DatabaseRecord): Stream {
  return {
    id: String(row.id),
    chatId: String(row.chatId),
    createdAt: toDate(row.createdAt),
  };
}

async function ensureResult<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  message: string
) {
  const { data, error } = await promise;

  if (error) {
    throw new ChatbotError("bad_request:database", message);
  }

  return data;
}

function getClient(): any {
  return getSupabaseAdminClient() as any;
}

export function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  const client = getClient();

  return ensureResult(
    client.from("Chat").insert({
      id,
      createdAt: new Date().toISOString(),
      userId,
      title,
      visibility,
    }),
    "Failed to save chat"
  );
}

export async function deleteChatById({ id }: { id: string }) {
  const client = getClient();

  try {
    await Promise.all([
      client.from("Vote_v2").delete().eq("chatId", id),
      client.from("Message_v2").delete().eq("chatId", id),
      client.from("Stream").delete().eq("chatId", id),
    ]);

    const deleted = await ensureResult(
      client.from("Chat").delete().eq("id", id).select().maybeSingle(),
      "Failed to delete chat by id"
    );

    return deleted ? mapChat(deleted as DatabaseRecord) : null;
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  const client = getClient();

  try {
    const chats = await ensureResult(
      client.from("Chat").select("id").eq("userId", userId),
      "Failed to delete all chats by user id"
    );

    const chatIds = toRecords(chats).map((chat) => String(chat.id));

    if (chatIds.length === 0) {
      return { deletedCount: 0 };
    }

    await Promise.all([
      client.from("Vote_v2").delete().in("chatId", chatIds),
      client.from("Message_v2").delete().in("chatId", chatIds),
      client.from("Stream").delete().in("chatId", chatIds),
    ]);

    const deletedChats = await ensureResult(
      client.from("Chat").delete().eq("userId", userId).select("id"),
      "Failed to delete all chats by user id"
    );

    return { deletedCount: toRecords(deletedChats).length };
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  const client = getClient();
  const extendedLimit = limit + 1;

  try {
    let query = client
      .from("Chat")
      .select("*")
      .eq("userId", id)
      .order("createdAt", { ascending: false })
      .limit(extendedLimit);

    if (startingAfter) {
      const selectedChat = await getChatById({ id: startingAfter });

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      query = query.gt("createdAt", selectedChat.createdAt.toISOString());
    } else if (endingBefore) {
      const selectedChat = await getChatById({ id: endingBefore });

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      query = query.lt("createdAt", selectedChat.createdAt.toISOString());
    }

    const chats = await ensureResult(query, "Failed to get chats by user id");
    const normalizedChats = toRecords(chats).map((chat) => mapChat(chat));
    const hasMore = normalizedChats.length > limit;

    return {
      chats: hasMore ? normalizedChats.slice(0, limit) : normalizedChats,
      hasMore,
    };
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }

    throw new ChatbotError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  const client = getClient();

  try {
    const chat = await ensureResult(
      client.from("Chat").select("*").eq("id", id).maybeSingle(),
      "Failed to get chat by id"
    );

    return chat ? mapChat(chat as DatabaseRecord) : null;
  } catch {
    throw new ChatbotError("bad_request:database", "Failed to get chat by id");
  }
}

export function saveMessages({ messages }: { messages: DBMessage[] }) {
  const client = getClient();

  return ensureResult(
    client.from("Message_v2").insert(
      messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      }))
    ),
    "Failed to save messages"
  );
}

export function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  const client = getClient();

  return ensureResult(
    client.from("Message_v2").update({ parts }).eq("id", id),
    "Failed to update message"
  );
}

export async function getMessagesByChatId({ id }: { id: string }) {
  const client = getClient();

  try {
    const messages = await ensureResult(
      client
        .from("Message_v2")
        .select("*")
        .eq("chatId", id)
        .order("createdAt", { ascending: true }),
      "Failed to get messages by chat id"
    );

    return toRecords(messages).map((message) => mapMessage(message));
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  const client = getClient();

  return ensureResult(
    client.from("Vote_v2").upsert(
      {
        chatId,
        messageId,
        isUpvoted: type === "up",
      },
      {
        onConflict: "chatId,messageId",
      }
    ),
    "Failed to vote message"
  );
}

export async function getVotesByChatId({ id }: { id: string }) {
  const client = getClient();

  try {
    const votes = await ensureResult(
      client.from("Vote_v2").select("*").eq("chatId", id),
      "Failed to get votes by chat id"
    );

    return toRecords(votes).map((vote) => mapVote(vote));
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  const client = getClient();

  try {
    const messages = await ensureResult(
      client.from("Message_v2").select("*").eq("id", id),
      "Failed to get message by id"
    );

    return toRecords(messages).map((message) => mapMessage(message));
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  const client = getClient();
  const isoTimestamp = timestamp.toISOString();

  try {
    const messagesToDelete = await ensureResult(
      client
        .from("Message_v2")
        .select("id")
        .eq("chatId", chatId)
        .gte("createdAt", isoTimestamp),
      "Failed to delete messages by chat id after timestamp"
    );

    const messageIds = toRecords(messagesToDelete).map((message) =>
      String(message.id)
    );

    if (messageIds.length === 0) {
      return;
    }

    await ensureResult(
      client
        .from("Vote_v2")
        .delete()
        .eq("chatId", chatId)
        .in("messageId", messageIds),
      "Failed to delete messages by chat id after timestamp"
    );

    return ensureResult(
      client
        .from("Message_v2")
        .delete()
        .eq("chatId", chatId)
        .in("id", messageIds),
      "Failed to delete messages by chat id after timestamp"
    );
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  const client = getClient();

  return ensureResult(
    client.from("Chat").update({ visibility }).eq("id", chatId),
    "Failed to update chat visibility by id"
  );
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  const client = getClient();

  try {
    return await ensureResult(
      client.from("Chat").update({ title }).eq("id", chatId),
      "Failed to update chat title by id"
    );
  } catch {
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  const client = getClient();

  try {
    const chats = await ensureResult(
      client.from("Chat").select("id").eq("userId", id),
      "Failed to get message count by user id"
    );

    const chatIds = toRecords(chats).map((chat) => String(chat.id));

    if (chatIds.length === 0) {
      return 0;
    }

    const cutoffTime = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    ).toISOString();

    const { count, error } = await client
      .from("Message_v2")
      .select("id", { count: "exact", head: true })
      .in("chatId", chatIds)
      .gte("createdAt", cutoffTime)
      .eq("role", "user");

    if (error) {
      throw error;
    }

    return count ?? 0;
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }
}

export function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  const client = getClient();

  return ensureResult(
    client.from("Stream").insert({
      id: streamId,
      chatId,
      createdAt: new Date().toISOString(),
    }),
    "Failed to create stream id"
  );
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  const client = getClient();

  try {
    const streams = await ensureResult(
      client
        .from("Stream")
        .select("id, createdAt, chatId")
        .eq("chatId", chatId)
        .order("createdAt", { ascending: true }),
      "Failed to get stream ids by chat id"
    );

    return toRecords(streams).map((stream) => mapStream(stream).id);
  } catch {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}
