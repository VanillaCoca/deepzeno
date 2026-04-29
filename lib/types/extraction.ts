import type { IRType } from "@/lib/ir-types";

export interface ExtractedDecision {
  type: IRType;
  content: string;
}

export interface ExtractedTopic {
  name: string;
  decisions: ExtractedDecision[];
}

export interface ExtractionResult {
  projectName: string;
  topics: ExtractedTopic[];
}
