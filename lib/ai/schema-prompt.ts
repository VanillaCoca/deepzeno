// Pure helpers — no server-only import so node:test can import directly.
//
// OpenAI-compatible endpoints (DeepSeek, DashScope, Bedrock Mantle,
// OpenRouter) receive only `response_format: {type: "json_object"}` from the
// AI SDK: without `supportsStructuredOutputs` the zod schema is silently
// DROPPED from the request, and json_object mode additionally requires the
// word "json" to appear in the prompt. (Flipping supportsStructuredOutputs on
// is not an option — these endpoints reject the json_schema response format.)
//
// This shim closes the gap: when the routed model can't receive the schema
// out-of-band, serialize it into the system prompt so the model still sees
// the exact shape zod will validate against.

import { asSchema } from "ai";
import type { z } from "zod";
import { findModelById } from "@/lib/ai/models";

// Whether generateObject must carry the schema inside the prompt for this
// model. providerType is exactly the right signal today: every
// openai-compatible entry lacks json_schema support, every other transport
// (anthropic / openai / bedrock / gateway) receives the schema natively.
export function needsSchemaInPrompt(modelId: string): boolean {
  return findModelById(modelId)?.providerType === "openai-compatible";
}

// Append the JSON Schema to the system prompt. Mentions "JSON" explicitly,
// which json_object mode requires somewhere in the request.
export function appendSchemaToSystem(
  system: string,
  schema: z.Schema<unknown>
): string {
  const jsonSchema = JSON.stringify(asSchema(schema).jsonSchema);
  return [
    system,
    "",
    "Return ONLY a single JSON object that validates against this JSON Schema — no markdown fences, no commentary:",
    jsonSchema,
  ].join("\n");
}

// One-stop wrapper used at every generateObject call site.
export function systemForModel(
  modelId: string,
  system: string,
  schema: z.Schema<unknown>
): string {
  return needsSchemaInPrompt(modelId)
    ? appendSchemaToSystem(system, schema)
    : system;
}
