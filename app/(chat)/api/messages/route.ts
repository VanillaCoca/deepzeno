import { auth } from "@/app/(auth)/auth";
import { getCompactionCheckpoint } from "@/lib/context/compaction-queries";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { convertToUIMessages } from "@/lib/utils";
import { listWorkspaceMessagesByConversationId } from "@/lib/workspace/queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return Response.json({ error: "chatId required" }, { status: 400 });
  }

  const [session, chat, messages, checkpoint, workspaceMessages] =
    await Promise.all([
      auth(),
      getChatById({ id: chatId }),
      getMessagesByChatId({ id: chatId }),
      getCompactionCheckpoint(chatId),
      listWorkspaceMessagesByConversationId(chatId),
    ]);

  if (!chat) {
    return Response.json({
      messages: [],
      visibility: "private",
      userId: null,
      isReadonly: false,
      compaction: null,
      models: {},
    });
  }

  if (
    chat.visibility === "private" &&
    (!session?.user || session.user.id !== chat.userId)
  ) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const isReadonly = !session?.user || session.user.id !== chat.userId;

  const modelByMessageId: Record<string, string> = {};
  for (const workspaceMessage of workspaceMessages) {
    if (workspaceMessage.role === "assistant" && workspaceMessage.model) {
      modelByMessageId[workspaceMessage.id] = workspaceMessage.model;
    }
  }

  return Response.json({
    messages: convertToUIMessages(messages),
    visibility: chat.visibility,
    userId: chat.userId,
    isReadonly,
    compaction: checkpoint
      ? {
          compactedThroughMessageId: checkpoint.compactedThroughMessageId,
          summarizedMessageCount: checkpoint.summarizedMessageCount,
        }
      : null,
    models: modelByMessageId,
  });
}
