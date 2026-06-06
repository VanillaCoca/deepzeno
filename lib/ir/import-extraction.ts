import "server-only";

import { generateText } from "ai";
import { getActiveModels, getDefaultModelId } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { isProductionEnvironment, isTestEnvironment } from "@/lib/constants";
import { IMPORT_EXTRACTION_SYSTEM_PROMPT } from "./import-extraction-prompt";
import type { ImportCandidate } from "./import-types";
import { importExtractorResponseSchema } from "./import-validation";

const MAX_IMPORT_DOCUMENT_CHARS = 60_000;
const MODEL_TIMEOUT_MS = 20_000;

export class ImportExtractionUnavailableError extends Error {
  statusCode = 503;
}

export type ImportExtractionResult = {
  candidates: ImportCandidate[];
  adapterStatus: "llm" | "mock";
  model: string;
  warning: string | null;
};

function parseStrictJsonObject(text: string) {
  const trimmed = text.trim();

  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    throw new Error("Import extractor did not return a raw JSON object.");
  }

  return JSON.parse(trimmed);
}

function inferMockKind(
  line: string
): Pick<ImportCandidate, "kind" | "subtype"> {
  const lower = line.toLowerCase();

  if (/question|open question|要不要|是否|会不会|能不能|\?$/.test(lower)) {
    return { kind: "open_question", subtype: null };
  }

  if (/constraint|must|require|不得|不能|必须|约束/.test(lower)) {
    return { kind: "constraint", subtype: null };
  }

  if (/task|todo|add|implement|write|修复|实现|新增/.test(lower)) {
    return { kind: "plan", subtype: "task" };
  }

  if (/milestone|phase|launch|里程碑|阶段/.test(lower)) {
    return { kind: "plan", subtype: "milestone" };
  }

  if (/reject|do not|won't|不会|不做|拒绝/.test(lower)) {
    return { kind: "rejection", subtype: null };
  }

  if (/hypothesis|assume|可能|假设/.test(lower)) {
    return { kind: "hypothesis", subtype: null };
  }

  if (/principle|rule|原则/.test(lower)) {
    return { kind: "principle", subtype: null };
  }

  if (/goal|aim|目标/.test(lower)) {
    return { kind: "goal", subtype: null };
  }

  return { kind: "plan", subtype: "decision" };
}

function inferMockStatus(line: string): ImportCandidate["suggested_status"] {
  const lower = line.toLowerCase();

  if (
    /\?|maybe|perhaps|might|consider|tbd|explore|可能|或许|考虑|待定|未确定|探索/.test(
      lower
    )
  ) {
    return "idea";
  }

  if (
    /decided|final|confirmed|locked|we will use|已决定|决定|确定|选定|敲定|最终|我们用/.test(
      lower
    )
  ) {
    return "active";
  }

  return "pending";
}

function cleanMockTitle(line: string) {
  return line
    .replace(/^[-*#>\s\d.)]+/, "")
    .replace(
      /^(decision|task|goal|constraint|question|principle)\s*[:：-]\s*/i,
      ""
    )
    .trim()
    .slice(0, 60);
}

function mockExtract(documentText: string): ImportCandidate[] {
  return documentText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && !line.startsWith("```"))
    .slice(0, 12)
    .map((line) => {
      const kind = inferMockKind(line);
      const status =
        kind.kind === "unclassified" ? "pending" : inferMockStatus(line);

      return {
        ...kind,
        title: cleanMockTitle(line) || line.slice(0, 60),
        content: line,
        rationale: null,
        suggested_status: status,
        confidence_caveat:
          status === "active" ? "Dev mock; review carefully." : null,
        source_text_span: line,
      };
    });
}

function canUseMockAdapter() {
  return (
    process.env.ZENO_IMPORT_MOCK === "1" ||
    (!isProductionEnvironment && isTestEnvironment)
  );
}

export async function extractImportCandidates(
  documentText: string
): Promise<ImportExtractionResult> {
  if (documentText.length > MAX_IMPORT_DOCUMENT_CHARS) {
    throw new ImportExtractionUnavailableError(
      `Import document is too large for V1 full-document extraction. Limit: ${MAX_IMPORT_DOCUMENT_CHARS} characters.`
    );
  }

  if (getActiveModels(process.env).length === 0) {
    if (!canUseMockAdapter()) {
      throw new ImportExtractionUnavailableError(
        "No LLM provider is configured for Bulk Import extraction."
      );
    }

    return {
      candidates: mockExtract(documentText),
      adapterStatus: "mock",
      model: "dev-only-mock",
      warning:
        "Bulk Import is using a non-production mock extractor because no LLM provider is configured.",
    };
  }

  const modelId = getDefaultModelId(process.env);
  const result = await generateText({
    model: getLanguageModel(modelId),
    system: IMPORT_EXTRACTION_SYSTEM_PROMPT,
    prompt: `<document>\n${documentText}\n</document>`,
    maxOutputTokens: 3000,
    maxRetries: 0,
    temperature: 0,
    timeout: MODEL_TIMEOUT_MS,
  });
  const parsed = importExtractorResponseSchema.parse(
    parseStrictJsonObject(result.text)
  );

  return {
    candidates: parsed.candidates,
    adapterStatus: "llm",
    model: modelId,
    warning: null,
  };
}
