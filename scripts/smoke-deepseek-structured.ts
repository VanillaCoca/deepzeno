/**
 * Live smoke test: DeepSeek structured output through the resilient path.
 *
 * Verifies the schema-prompt shim end-to-end — generateObjectResilient with
 * preferredModelId "deepseek:default" must return a zod-valid object even
 * though the OpenAI-compatible transport drops the schema from the request.
 * Spends a few hundred DeepSeek tokens; no DB access.
 *
 * Run:
 *   NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/smoke-deepseek-structured.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY missing — nothing to smoke-test.");
    process.exit(1);
  }

  const { z } = await import("zod");
  const { generateObjectResilient } = await import(
    "../lib/ai/resilient-generate"
  );

  const intentSchema = z.object({
    intents: z
      .array(z.object({ query: z.string().min(3), goal: z.string() }))
      .min(1)
      .max(3),
  });

  const result = await generateObjectResilient({
    task: "research_plan",
    preferredModelId: "deepseek:default",
    system:
      'Decompose into independent, factually-checkable web-search intents. Respond with a JSON object: {"intents": [{"query": "...", "goal": "..."}]}.',
    prompt:
      "## Origin Node\nKind: hypothesis\nTitle: 假设:加拿大联邦技术移民(EE)抽分线未来 12 个月不会大幅上涨\n\nDecompose this origin node into up to 3 independent, factually-checkable web-search intents. Return them as JSON.",
    schema: intentSchema,
  });

  console.log("modelId:", result.modelId, "| degraded:", result.degraded);
  console.log("usage:", JSON.stringify(result.usage));
  console.log("intents:");
  for (const intent of result.object.intents) {
    console.log(`  - [${intent.query}] → ${intent.goal}`);
  }

  if (result.modelId !== "deepseek:default") {
    console.error("FAIL: expected deepseek:default to serve the request");
    process.exit(1);
  }
  console.log("PASS: DeepSeek returned schema-valid structured output.");
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exit(1);
});
