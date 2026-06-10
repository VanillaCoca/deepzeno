import "server-only";

import { createHash } from "node:crypto";
import { generateObject } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  type ClassifiedDecisionKind,
  decisionKindOrder,
  isDecisionKind,
} from "@/lib/decision-kinds";
import { serializeDecisionGraph } from "@/lib/decision-serializer";
import {
  governExtractionCandidates,
  resolveGovernorConfig,
} from "@/lib/extraction-governor";
import { extractionSystemPrompt } from "@/lib/prompting";
import {
  getCandidateByContentHash,
  insertCandidateDecisions,
  listDecisionsByTopicId,
  listEdgesByTopicId,
  listPendingCandidatesByTopicId,
  listRecentWorkspaceMessagesByConversationId,
} from "@/lib/workspace/queries";
import type { WorkspaceMessageRecord } from "@/lib/workspace/types";

const extractedCandidateSchema = z.object({
  proposed_title: z.string().min(1).max(160).nullable().optional(),
  proposed_content: z.string().min(1).max(4000),
  proposed_rationale: z.string().max(4000).nullable().optional(),
  proposed_kind: z.enum(decisionKindOrder).nullable().optional(),
  proposed_weight: z.enum(["anchor", "key", "normal"]).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  suggested_edges: z
    .array(
      z.object({
        type: z.string().min(1),
        target_decision_id: z.string().uuid().optional(),
      })
    )
    .nullable()
    .optional(),
  relevant_message_ids: z.array(z.string().uuid()).default([]),
  pre_selected: z.boolean().nullable().optional(),
});

const extractionResponseSchema = z.object({
  candidates: z.array(extractedCandidateSchema),
});

function computeContentHash({
  conversationId,
  messageId,
  content,
}: {
  conversationId: string;
  messageId: string;
  content: string;
}) {
  return createHash("sha256")
    .update(`${conversationId}:${messageId}:${content.trim().toLowerCase()}`)
    .digest("hex");
}

function summarizeTitle(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function inferKind(content: string): ClassifiedDecisionKind {
  const text = content.toLowerCase();

  if (
    text.includes("以后再说") ||
    text.includes("先不决定") ||
    text.includes("待定") ||
    text.includes("we'll decide later") ||
    text.includes("decide later") ||
    text.includes("看情况")
  ) {
    return "open_question";
  }

  if (
    text.includes("不买") ||
    text.includes("不碰") ||
    text.includes("不要做") ||
    text.includes("不要") ||
    text.includes("不考虑") ||
    text.includes("先不做") ||
    text.includes("排除") ||
    text.includes("避免") ||
    text.includes("not use") ||
    text.includes("decided not to")
  ) {
    return "rejection";
  }

  if (
    text.includes("must") ||
    text.includes("cannot") ||
    text.includes("need to") ||
    text.includes("需要") ||
    text.includes("必须")
  ) {
    return "constraint";
  }

  if (
    text.includes("goal") ||
    text.includes("target") ||
    text.includes("aim") ||
    text.includes("目标")
  ) {
    return "goal";
  }

  if (
    text.includes("assume") ||
    text.includes("hypothesis") ||
    text.includes("猜测")
  ) {
    return "hypothesis";
  }

  if (
    text.includes("principle") ||
    text.includes("原则") ||
    text.includes("prefer")
  ) {
    return "principle";
  }

  return "plan";
}

function heuristicExtraction(
  messages: WorkspaceMessageRecord[],
  assistantMessageId: string
): z.infer<typeof extractedCandidateSchema>[] {
  const sourceMessages = messages.slice(-4);
  const assistantMessage = sourceMessages.find(
    (message: WorkspaceMessageRecord) => message.id === assistantMessageId
  );

  if (!assistantMessage?.content.trim()) {
    return [];
  }

  const segments = assistantMessage.content
    .split(/[\n。！？.!?]/)
    .map((segment: string) => segment.trim())
    .filter(Boolean)
    .filter((segment: string) => segment.length > 8)
    .filter((segment: string) =>
      /(will|should|must|need|use|prefer|decide|plan|adopt|avoid|target|需要|采用|决定|计划|应该|将|目标|优先|不买|不碰|不要|先不|排除|避免|只做)/i.test(
        segment
      )
    )
    .slice(0, 5);

  return segments.map((segment: string) => {
    const kind = inferKind(segment);

    return {
      proposed_title: summarizeTitle(segment),
      proposed_content: segment,
      proposed_rationale: "Extracted with the lightweight fallback extractor.",
      proposed_kind: kind,
      proposed_weight: "normal" as const,
      confidence:
        kind === "open_question" || kind === "rejection" ? 0.45 : 0.55,
      suggested_edges: [],
      relevant_message_ids: sourceMessages.map(
        (message: WorkspaceMessageRecord) => message.id
      ),
      pre_selected: kind === "rejection" ? false : undefined,
    };
  });
}

function normalizeCandidates(
  rawCandidates: z.infer<typeof extractedCandidateSchema>[]
) {
  return rawCandidates
    .map((candidate) => {
      const proposedKind = candidate.proposed_kind ?? "plan";

      if (!isDecisionKind(proposedKind)) {
        console.warn("Dropping extracted candidate with unsupported kind", {
          proposedKind,
        });
        return null;
      }

      const confidence = candidate.confidence ?? 0.75;
      const preSelected =
        candidate.pre_selected ??
        (proposedKind === "rejection" ? false : confidence >= 0.5);

      return {
        proposedTitle: candidate.proposed_title?.trim() || null,
        proposedContent: candidate.proposed_content.trim(),
        proposedRationale: candidate.proposed_rationale?.trim() || null,
        proposedKind,
        proposedWeight: candidate.proposed_weight ?? "normal",
        confidence,
        preSelected,
        suggestedEdges:
          candidate.suggested_edges?.map((edge) => ({
            type: edge.type,
            ...(edge.target_decision_id
              ? { targetDecisionId: edge.target_decision_id }
              : {}),
          })) ?? [],
        relevantMessageIds: candidate.relevant_message_ids,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate)
    )
    .filter((candidate) => candidate.proposedContent.length > 0);
}

export async function extractDecisions({
  conversationId,
  topicId,
  projectId,
  messageId,
  assistantModel,
}: {
  conversationId: string;
  topicId: string;
  projectId: string;
  messageId: string;
  assistantModel: string;
}) {
  try {
    const [messages, decisions, edges] = await Promise.all([
      listRecentWorkspaceMessagesByConversationId(conversationId, 20),
      listDecisionsByTopicId(topicId),
      listEdgesByTopicId(topicId),
    ]);

    if (messages.length === 0) {
      return;
    }

    const serializedGraph = serializeDecisionGraph(decisions, edges);
    const transcript = messages
      .map(
        (message: WorkspaceMessageRecord) =>
          `[${message.id}] ${message.role.toUpperCase()}: ${message.content || "(no text content)"}`
      )
      .join("\n");

    let normalized: ReturnType<typeof normalizeCandidates> = [];
    let extractionSourceModel = "heuristic-fallback";
    const extractionPrompt = `Existing decisions:\n${serializedGraph || "(none)"}\n\nConversation:\n${transcript}`;

    try {
      const extractorModelId = process.env.ANTHROPIC_API_KEY
        ? "anthropic:claude-sonnet-4-6"
        : assistantModel;

      const result = await generateObject({
        model: getLanguageModel(extractorModelId),
        system: extractionSystemPrompt,
        prompt: extractionPrompt,
        schema: extractionResponseSchema,
      });

      normalized = normalizeCandidates(result.object.candidates);
      extractionSourceModel = extractorModelId;
    } catch (modelError) {
      console.warn("Structured decision extraction failed, falling back", {
        assistantModel,
        error:
          modelError instanceof Error ? modelError.message : String(modelError),
      });

      normalized = normalizeCandidates(
        heuristicExtraction(messages, messageId)
      );
    }

    const governor = resolveGovernorConfig();
    let pendingPoolSize = 0;

    try {
      pendingPoolSize = (await listPendingCandidatesByTopicId(topicId)).length;
    } catch {
      // An unreadable pool must not block extraction; treat it as empty.
    }

    const backpressured = pendingPoolSize >= governor.pendingPoolSoftCap;
    const { admitted, droppedByBackpressure, droppedByCap } =
      governExtractionCandidates(normalized, {
        maxCandidates: governor.maxExtractionCandidates,
        backpressured,
        minConfidence: governor.backpressureMinConfidence,
      });

    if (droppedByBackpressure + droppedByCap > 0) {
      console.warn("Extraction governor limited candidate admission", {
        topicId,
        extracted: normalized.length,
        admitted: admitted.length,
        droppedByBackpressure,
        droppedByCap,
        pendingPoolSize,
      });
    }

    for (const candidate of admitted) {
      const contentHash = computeContentHash({
        conversationId,
        messageId,
        content: candidate.proposedContent,
      });

      const existing = await getCandidateByContentHash({
        conversationId,
        contentHash,
      });

      if (existing) {
        continue;
      }

      await insertCandidateDecisions([
        {
          projectId,
          topicId,
          conversationId,
          messageId,
          proposedTitle: candidate.proposedTitle,
          proposedContent: candidate.proposedContent,
          proposedRationale: candidate.proposedRationale,
          proposedKind: candidate.proposedKind,
          proposedWeight: candidate.proposedWeight,
          confidence: candidate.confidence,
          preSelected: candidate.preSelected,
          suggestedEdges: candidate.suggestedEdges,
          relevantMessageIds: candidate.relevantMessageIds,
          contentHash,
          source: "zeno_extraction",
          sourceMetadata: {
            model: extractionSourceModel,
          },
        },
      ]);
    }
  } catch (error) {
    console.error("Decision extraction failed", error);
  }
}
