import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { routeAutoModel } from "@/lib/ai/model-policy";
import {
  getActiveModels,
  getCapabilities,
  resolveChatModelSelection,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { isProductionEnvironment } from "@/lib/constants";
import { prepareCompactedContext } from "@/lib/context/compaction";
import { assembleContext } from "@/lib/context-assembly";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { localePromptName } from "@/lib/i18n/dictionaries";
import { persistInlineIRMarkersForMessages } from "@/lib/ir/inline-markers";
import { runIRSweep } from "@/lib/ir/sweep";
import { buildDecisionContextBlock } from "@/lib/prompting";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import {
  convertToUIMessages,
  generateUUID,
  getTextFromMessage,
} from "@/lib/utils";
import { saveWorkspaceMessages } from "@/lib/workspace/queries";
import {
  ensureWorkspaceSelectionForUser,
  getWorkspaceMessagesForSandbox,
} from "@/lib/workspace/service";
import type { WorkspaceMessageRecord } from "@/lib/workspace/types";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

function getMessageModelOverride(text: string) {
  const match = text.match(/(?:^|\s)@([^\s]+)/);

  if (!match) {
    return null;
  }

  const mentionedModel = match[1];
  const activeModels = getActiveModels(process.env);

  return activeModels.find((model) => model.id === mentionedModel)?.id ?? null;
}

function messageHasImage(message?: ChatMessage): boolean {
  return Boolean(
    message?.parts?.some((part) => {
      if (part.type !== "file") {
        return false;
      }
      const mediaType = (part as { mediaType?: unknown }).mediaType;
      return typeof mediaType === "string" && mediaType.startsWith("image/");
    })
  );
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    const parsed = postRequestBodySchema.safeParse(json);

    if (!parsed.success) {
      console.error("Chat API request body validation failed", {
        issues: parsed.error.issues,
        body: json,
      });
      return new ChatbotError("bad_request:api").toResponse();
    }

    requestBody = parsed.data;
  } catch (error) {
    console.error("Chat API request body parsing failed", error);
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const {
      message,
      messages,
      selectedChatModel,
      selectedVisibilityType,
      projectId,
      topicId,
      conversationId,
      restoredContextMessageIds = [],
      injectedDecisionContext,
      locale,
      qualityPreference,
    } = requestBody;
    console.info("Chat API request received", {
      selectedChatModel,
      projectId,
      topicId,
      conversationId,
      messageRole: message?.role ?? null,
      messagesCount: messages?.length ?? 0,
      restoredContextMessageIdsCount: restoredContextMessageIds.length,
      hasInjectedDecisionContext: Boolean(injectedDecisionContext?.trim()),
    });
    const id = conversationId;

    const [, session] = await Promise.all([
      process.env.NODE_ENV === "production"
        ? checkBotId().catch(() => null)
        : Promise.resolve(null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 1,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const workspaceSelection = await ensureWorkspaceSelectionForUser({
      userId: session.user.id,
      projectId,
      topicId,
      conversationId,
    });
    console.info("Chat API workspace selection ready", {
      projectId: workspaceSelection.project.id,
      topicId: workspaceSelection.topic.id,
      conversationId: workspaceSelection.conversation.id,
      isGeneralTopic: workspaceSelection.topic.isGeneral,
      topicDefaultModelId: workspaceSelection.topic.defaultModelId,
    });
    const messageModelOverride = message?.role
      ? getMessageModelOverride(getTextFromMessage(message))
      : null;
    const selectedModelId =
      messageModelOverride ??
      workspaceSelection.topic.defaultModelId ??
      selectedChatModel;
    const effectiveModelId =
      selectedModelId === "auto"
        ? routeAutoModel(
            {
              text: message ? getTextFromMessage(message) : "",
              hasImage: messageHasImage(message as ChatMessage | undefined),
            },
            qualityPreference ?? "balanced",
            process.env
          )
        : selectedModelId;
    const resolvedModel = resolveChatModelSelection(
      effectiveModelId,
      process.env
    );

    if (!resolvedModel) {
      return new ChatbotError(
        "bad_request:api",
        "No AI model is configured. Add Anthropic, OpenAI, DeepSeek, DashScope, or AI Gateway environment variables."
      ).toResponse();
    }

    const chatModel = resolvedModel.id;
    const shouldInjectWorkspaceContext = !workspaceSelection.topic.isGeneral;

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string | null> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
      // A title is non-essential and may call a DIFFERENT provider than the chat
      // model (e.g. the title model resolves to OpenAI while chat runs on
      // Bedrock). Swallow its failure here so it can never reject and break the
      // answer stream — that was the "first message of a new conversation always
      // errors" bug. We catch at creation (not just at await) to avoid an
      // unhandled rejection if the title fails before the stream consumes it.
      titlePromise = generateTitleFromUserMessage({ message }).catch(
        (titleError) => {
          console.error(
            "Title generation failed; using a fallback title",
            titleError
          );
          // Local fallback so a new chat still gets a meaningful name without the
          // (possibly unreachable) title model — first line / first ~50 chars of
          // the user's message.
          const text = getTextFromMessage(message).trim();
          const firstLine = text.split(/\r?\n/)[0] ?? "";
          return firstLine.slice(0, 50).trim() || null;
        }
      );
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });

      await saveWorkspaceMessages([
        {
          id: message.id,
          conversationId,
          topicId,
          projectId,
          role: "user",
          content: getTextFromMessage(message),
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    const modelCapabilities = getCapabilities(process.env);
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;

    const [decisionContext, restoredWorkspaceMessages] = await Promise.all([
      shouldInjectWorkspaceContext
        ? assembleContext(topicId, projectId)
        : Promise.resolve(""),
      restoredContextMessageIds.length > 0
        ? getWorkspaceMessagesForSandbox({
            userId: session.user.id,
            messageIds: restoredContextMessageIds,
          })
        : Promise.resolve([]),
    ]);
    const restoredContextBlock =
      restoredWorkspaceMessages.length > 0
        ? `<restored_context>\n${restoredWorkspaceMessages
            .map(
              (currentMessage: WorkspaceMessageRecord) =>
                `[${currentMessage.id}] ${currentMessage.role.toUpperCase()}: ${currentMessage.content}`
            )
            .join("\n")}\n</restored_context>`
        : "";
    const injectedDecisionContextBlock = injectedDecisionContext?.trim()
      ? `<discussion_context>\n${injectedDecisionContext.trim()}\n</discussion_context>`
      : "";

    // System prompt WITHOUT the conversation summary (used for token budgeting).
    const baseSystemText = [
      systemPrompt({
        requestHints,
        languageName: locale ? localePromptName[locale] : undefined,
      }),
      shouldInjectWorkspaceContext
        ? buildDecisionContextBlock(decisionContext)
        : "",
      restoredContextBlock,
      injectedDecisionContextBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    // Automatic conversation compaction: fold older turns into a rolling summary
    // so a long conversation never overflows the model's context window. The
    // tool-approval continuation flow is left untouched (in-flight tool calls).
    let conversationSummaryBlock = "";
    let payloadUiMessages = uiMessages;
    if (!isToolApprovalFlow) {
      const compaction = await prepareCompactedContext({
        conversationId,
        historyMessages: messagesFromDb,
        currentMessage: message as ChatMessage | undefined,
        baseSystemText,
        modelId: chatModel,
        provider: resolvedModel.provider,
      });
      conversationSummaryBlock = compaction.summaryBlock;
      payloadUiMessages = uiMessages.filter((uiMessage) =>
        compaction.keepMessageIds.has(uiMessage.id)
      );
    }

    const fullSystemText = [baseSystemText, conversationSummaryBlock]
      .filter(Boolean)
      .join("\n\n");
    const modelMessages = await convertToModelMessages(payloadUiMessages);

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        const result = streamText({
          model: getLanguageModel(chatModel),
          system: fullSystemText,
          messages: modelMessages,
          stopWhen: stepCountIs(5),
          providerOptions: {
            ...(resolvedModel.gatewayOrder && {
              gateway: { order: resolvedModel.gatewayOrder },
            }),
            ...(resolvedModel.reasoningEffort && {
              openai: { reasoningEffort: resolvedModel.reasoningEffort },
            }),
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
        });

        dataStream.write({ type: "data-model", data: chatModel });

        dataStream.merge(
          result.toUIMessageStream({ sendReasoning: isReasoningModel })
        );

        if (titlePromise) {
          const title = await titlePromise;
          if (title) {
            dataStream.write({ type: "data-chat-title", data: title });
            updateChatTitleById({ chatId: id, title });
          }
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        const inlineMarkerResult = shouldInjectWorkspaceContext
          ? await persistInlineIRMarkersForMessages({
              conversationId,
              messages: finishedMessages as ChatMessage[],
              projectId,
              topicId,
              userId: session.user.id,
            })
          : null;
        const finalMessages =
          inlineMarkerResult?.messages ?? (finishedMessages as ChatMessage[]);

        if (isToolApprovalFlow) {
          for (const finishedMsg of finalMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                  },
                ],
              });
            }
          }
        } else if (finalMessages.length > 0) {
          await saveMessages({
            messages: finalMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }

        const workspaceMessages = finalMessages
          .filter(
            (currentMessage) =>
              currentMessage.role === "assistant" ||
              currentMessage.role === "user" ||
              currentMessage.role === "system"
          )
          .map((currentMessage) => ({
            id: currentMessage.id,
            conversationId,
            topicId,
            projectId,
            role: currentMessage.role as "user" | "assistant" | "system",
            content: getTextFromMessage(currentMessage),
            model: currentMessage.role === "assistant" ? chatModel : null,
            createdAt:
              currentMessage.metadata?.createdAt ?? new Date().toISOString(),
          }));

        await saveWorkspaceMessages(workspaceMessages);

        const assistantMessages = finalMessages.filter(
          (currentMessage) =>
            currentMessage.role === "assistant" &&
            getTextFromMessage(currentMessage).trim().length > 0
        );

        const lastAssistantMessage = assistantMessages.at(-1);

        if (shouldInjectWorkspaceContext && lastAssistantMessage) {
          after(() => {
            runIRSweep({
              sweepId: generateId(),
              userId: session.user.id,
              conversationId,
              projectId,
            }).catch(console.error);
          });
        }
      },
      onError: (error) => {
        console.error("Chat stream execution error", error);
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
        }
        return "Oops, an error occurred!";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          /* non-critical */
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      console.error("Chat API handled error:", {
        code: `${error.type}:${error.surface}`,
        cause: error.cause,
      });
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
