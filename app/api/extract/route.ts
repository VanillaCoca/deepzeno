import type { ExtractionResult } from "@/lib/types/extraction";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text =
    body && typeof body === "object" && "text" in body ? body.text : undefined;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return Response.json({ error: "Text is required" }, { status: 400 });
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const result: ExtractionResult = {
    projectName: "Zeno V1",
    topics: [
      {
        name: "Product identity",
        decisions: [
          {
            type: "goal",
            content: "Build the memory layer for AI-assisted thinking",
          },
          {
            type: "hypothesis",
            content: "18-month competitive window before platform compression",
          },
        ],
      },
      {
        name: "Architecture invariants",
        decisions: [
          {
            type: "constraint",
            content: "Never own the execution environment, only decision truth",
          },
          {
            type: "principle",
            content: "宁漏勿错 — preserve trust over recall",
          },
        ],
      },
      {
        name: "Pricing model",
        decisions: [
          {
            type: "open_question",
            content: "Pricing tier thresholds — exact numbers",
          },
          {
            type: "open_question",
            content: "BYOK timing — V1 vs post-V1",
          },
        ],
      },
    ],
  };

  return Response.json(result);
}
