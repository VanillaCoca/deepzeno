import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getDefaultModelId } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { addUsage, type ModelsUsedAccumulator } from "@/lib/billing/cost-core";
import {
  fundingForModel,
  loadUserFunding,
  settleUsage,
  withUserFunding,
} from "@/lib/billing/funding";
import { ChatbotError } from "@/lib/errors";
import type { IRType } from "@/lib/ir-types";
import type { ExtractionResult } from "@/lib/types/extraction";

const irTypeValues = [
  "goal",
  "constraint",
  "hypothesis",
  "open_question",
  "plan",
  "principle",
  "rejection",
] as const satisfies readonly IRType[];

const extractRequestSchema = z.object({
  text: z.string().trim().min(1).max(50_000),
});

const extractedDecisionSchema = z.object({
  type: z.enum(irTypeValues),
  content: z.string().min(1).max(1200),
});

const extractionResultSchema = z.object({
  projectName: z.string().min(1).max(120),
  topics: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        decisions: z.array(extractedDecisionSchema).default([]),
      })
    )
    .default([]),
});

type RawExtractionResult = z.infer<typeof extractionResultSchema>;

const MODEL_TIMEOUT_MS = 15_000;

function buildExtractionSystemPrompt() {
  return `You are ZENO's project bootstrap extraction worker.

The user is creating a project from notes or a prompt. Extract only durable project memory that the user can review before it becomes truth.

Rules:
- Return JSON only. No markdown fences, no commentary.
- Shape: {"projectName":"...","topics":[{"name":"...","decisions":[{"type":"goal|constraint|hypothesis|open_question|plan|principle|rejection","content":"..."}]}]}
- Infer a short projectName from the input. Do not use "ZENO V1" unless the user actually wrote that.
- Group related decisions into concise topic names.
- Extract user-stated goals, constraints, plans/tasks, hypotheses, principles, open questions, and explicit rejections.
- Use rejection only when the user explicitly decides not to pursue an option.
- Use open_question for unresolved choices, TBD items, or "decide later" statements.
- Preserve the user's language where possible.
- Prefer 1-5 topics and 1-6 decisions per topic.
- If the input has no durable project memory, return an inferred projectName and an empty topics array.
- These are review items only; never imply they are already confirmed truth.`;
}

function buildExtractionPrompt(text: string) {
  return `<project_notes>\n${text}\n</project_notes>`;
}

function parseJsonObject(text: string) {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("Extraction model did not return a JSON object.");
  }

  return JSON.parse(stripped.slice(start, end + 1));
}

function compactWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number) {
  const normalized = compactWhitespace(text);
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3).trim()}...`
    : normalized;
}

function inferProjectName(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => /^#{1,3}\s+\S/.test(line));

  if (heading) {
    return truncate(heading.replace(/^#{1,3}\s+/, ""), 60);
  }

  const namedMatch = text.match(
    /(?:project|project name|项目|项目名|产品|产品名)\s*[:：]\s*([^\n。！？.!?]{2,80})/i
  );

  if (namedMatch?.[1]) {
    return truncate(namedMatch[1], 60);
  }

  const firstMeaningfulLine = lines.find((line) => line.length >= 4);

  if (firstMeaningfulLine) {
    return truncate(firstMeaningfulLine.replace(/^[-*•\d.)\s]+/, ""), 60);
  }

  return "Untitled project";
}

function inferType(content: string): IRType {
  const text = content.toLowerCase();

  if (
    /待定|以后再说|先放着|还没决定|不确定|open question|tbd|decide later|figure out later/.test(
      text
    )
  ) {
    return "open_question";
  }

  if (
    /不做|不考虑|不要|放弃|排除|拒绝|先不|won't|will not|do not|don't|decided not|reject|avoid/.test(
      text
    )
  ) {
    return "rejection";
  }

  if (
    /必须|不能|不可|只允许|边界|约束|must|cannot|required|constraint|non-negotiable/.test(
      text
    )
  ) {
    return "constraint";
  }

  if (/原则|准则|倾向|优先|宁|prefer|principle|guideline|rule/.test(text)) {
    return "principle";
  }

  if (
    /假设|猜测|预计|可能|hypothesis|assume|assumption|if .* then/.test(text)
  ) {
    return "hypothesis";
  }

  if (/目标|指标|达成|goal|target|objective|success metric/.test(text)) {
    return "goal";
  }

  return "plan";
}

function inferTopicName(content: string, type: IRType) {
  const text = content.toLowerCase();

  if (
    /price|pricing|subscription|revenue|byok|商业|收费|价格|订阅|套餐/.test(
      text
    )
  ) {
    return "Pricing";
  }

  if (
    /api|database|db|supabase|llm|model|worker|migration|architecture|接口|数据库|迁移|模型|架构/.test(
      text
    )
  ) {
    return "Architecture";
  }

  if (
    /ui|ux|textarea|button|homepage|workspace|frontend|首页|按钮|页面|工作区|前端/.test(
      text
    )
  ) {
    return "Product experience";
  }

  if (/v1|mvp|launch|release|milestone|上线|版本|里程碑/.test(text)) {
    return "Release scope";
  }

  if (type === "open_question") {
    return "Open questions";
  }

  if (type === "goal") {
    return "Goals";
  }

  return "Project decisions";
}

function splitIntoSegments(text: string) {
  return text
    .split(/\n+|(?<=[。！？.!?])\s+/)
    .map((segment) => compactWhitespace(segment.replace(/^[-*•\d.)\s]+/, "")))
    .filter((segment) => segment.length >= 8);
}

function hasExtractionSignal(segment: string) {
  return /(决定|必须|不能|不做|不考虑|放弃|排除|原则|目标|假设|实现|修复|创建|计划|应该|需要|采用|优先|待定|decide|decided|must|cannot|will|should|need|principle|goal|assume|implement|build|ship|avoid|reject|tbd|open question)/i.test(
    segment
  );
}

function heuristicExtract(text: string): ExtractionResult {
  const signalSegments = splitIntoSegments(text)
    .filter(hasExtractionSignal)
    .slice(0, 12);
  const topicMap = new Map<string, ExtractionResult["topics"][number]>();

  if (signalSegments.length === 0) {
    return {
      projectName: inferProjectName(text),
      topics: [],
    };
  }

  for (const segment of signalSegments) {
    const type = inferType(segment);
    const topicName = inferTopicName(segment, type);
    const topic =
      topicMap.get(topicName) ??
      ({
        name: topicName,
        decisions: [],
      } satisfies ExtractionResult["topics"][number]);

    topic.decisions.push({
      type,
      content: truncate(segment, 400),
    });
    topicMap.set(topicName, topic);
  }

  return {
    projectName: inferProjectName(text),
    topics: Array.from(topicMap.values()).filter(
      (topic) => topic.decisions.length > 0
    ),
  };
}

function normalizeExtractionResult(
  result: RawExtractionResult,
  sourceText: string
): ExtractionResult {
  const seen = new Set<string>();
  const topics = result.topics
    .map((topic) => {
      const decisions = topic.decisions
        .map((decision) => ({
          type: decision.type,
          content: truncate(decision.content, 600),
        }))
        .filter((decision) => {
          const key = `${decision.type}:${decision.content.toLowerCase()}`;

          if (decision.content.length === 0 || seen.has(key)) {
            return false;
          }

          seen.add(key);
          return true;
        })
        .slice(0, 8);

      return {
        name: truncate(topic.name, 80) || "Project decisions",
        decisions,
      };
    })
    .filter((topic) => topic.decisions.length > 0)
    .slice(0, 6);

  return {
    projectName:
      truncate(result.projectName, 80) || inferProjectName(sourceText),
    topics,
  };
}

async function extractWithModel(
  text: string,
  modelsUsed: ModelsUsedAccumulator
): Promise<ExtractionResult> {
  const modelId = getDefaultModelId(process.env);
  const result = await generateText({
    model: getLanguageModel(modelId),
    system: buildExtractionSystemPrompt(),
    prompt: buildExtractionPrompt(text),
    maxOutputTokens: 1600,
    maxRetries: 0,
    temperature: 0,
    timeout: MODEL_TIMEOUT_MS,
  });

  // Before the parse, and unconditionally: `maxRetries: 0` means a malformed
  // answer is the whole purchase, and the fallback below hides that from every
  // other signal in this route.
  addUsage(modelsUsed, modelId, result.usage);

  const parsed = extractionResultSchema.parse(parseJsonObject(result.text));

  return normalizeExtractionResult(parsed, text);
}

/**
 * Turn notes into a project's first draft of memory.
 *
 * This route had no `auth()` at all until now, which made it the cheapest way
 * in the product to spend the operator's money: 50,000 characters to the
 * default model, from anyone who knew the URL, in a loop, forever. It was not
 * an oversight about billing so much as about the shape of the thing — the
 * route was written as a stateless text utility, and a stateless text utility
 * that calls a paid model is a donation endpoint. The session is what turns
 * the spend into somebody's spend; the allowance check is only possible once
 * there is a somebody.
 *
 * An exhausted allowance degrades to the heuristic rather than refusing.
 * Project creation is the first thing a user ever does here, `heuristicExtract`
 * is a real non-model path that already ships as the no-provider fallback, and
 * everything this returns is a review draft the user edits before any of it
 * becomes truth. Blocking the door to protect a few cents of extraction would
 * be the wrong trade. What would be wrong in the other direction is degrading
 * in silence, so the response says which extractor answered.
 */
export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const body = await request.json().catch(() => null);
  const input = extractRequestSchema.safeParse(body);

  if (!input.success) {
    return Response.json({ error: "Text is required" }, { status: 400 });
  }

  const funding = await loadUserFunding(session.user.id);
  const denied =
    !funding.unmetered &&
    fundingForModel(funding, getDefaultModelId(process.env)).source ===
      "denied";

  if (denied) {
    return Response.json({
      ...heuristicExtract(input.data.text),
      extractor: "heuristic",
      allowance_exhausted: true,
    });
  }

  const modelsUsed: ModelsUsedAccumulator = {};

  try {
    const result = await withUserFunding(funding, () =>
      extractWithModel(input.data.text, modelsUsed)
    );

    return Response.json({ ...result, extractor: "model" });
  } catch (error) {
    console.warn("Model-backed project extraction failed, using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });

    return Response.json({
      ...heuristicExtract(input.data.text),
      extractor: "heuristic",
    });
  } finally {
    // In `finally` so the fallback path pays too: a call that came back
    // unparsable bought exactly as many tokens as one that came back clean.
    await settleUsage({ funding, modelsUsed, kind: "import" }).catch(
      (settleError) => {
        console.error("Failed to settle project extraction usage", {
          error:
            settleError instanceof Error
              ? settleError.message
              : String(settleError),
        });
      }
    );
  }
}
