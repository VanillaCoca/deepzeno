import { z } from "zod";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1).max(50_000),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user"]),
  parts: z.array(partSchema),
});

const toolApprovalMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.record(z.unknown())),
});

export const postRequestBodySchema = z.object({
  id: z.string().uuid(),
  message: userMessageSchema.optional(),
  messages: z.array(toolApprovalMessageSchema).optional(),
  selectedChatModel: z.string(),
  selectedVisibilityType: z.enum(["public", "private"]),
  projectId: z.string().uuid(),
  topicId: z.string().uuid(),
  conversationId: z.string().uuid(),
  restoredContextMessageIds: z.array(z.string().uuid()).optional(),
  injectedDecisionContext: z.string().max(12_000).nullish(),
  locale: z.enum(["en", "zh", "fr"]).optional(),
  qualityPreference: z.enum(["economy", "balanced", "best"]).optional(),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
