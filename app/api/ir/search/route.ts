import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getTitleModel } from "@/lib/ai/providers";
import { ChatbotError } from "@/lib/errors";
import { irErrorToResponse } from "@/lib/ir/api";
import { listIRNodesForUser } from "@/lib/ir/queries";
import type { IRNode, IRStatus } from "@/lib/ir/types";
import { getIRTypeLabel } from "@/lib/ir/types";

const bodySchema = z.object({
  projectId: z.string().uuid(),
  query: z.string().trim().min(1).max(300),
});

// All reasoning content, across every topic, is searchable.
const SEARCH_STATUSES: IRStatus[] = ["active", "pending", "idea"];
// Cap how many nodes we hand to the model so the prompt stays bounded.
const MAX_CANDIDATES = 250;
const MAX_RESULTS = 12;
const SNIPPET_LEN = 200;

function snippet(node: IRNode) {
  const text = (node.rationale ?? node.content ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > SNIPPET_LEN ? `${text.slice(0, SNIPPET_LEN)}…` : text;
}

async function loadCandidates(userId: string, projectId: string) {
  const lists = await Promise.all(
    SEARCH_STATUSES.map((status) =>
      listIRNodesForUser({ userId, projectId, status })
    )
  );
  // Already ordered newest-first per status; keep a bounded, recent slice.
  return lists.flat().slice(0, MAX_CANDIDATES);
}

// Ask a lightweight model to pick the semantically relevant nodes, ranked.
// Returns the ordered node ids, or null if the model is unavailable / unparsable
// (callers fall back to a keyword match so search never hard-fails).
async function rankWithModel(
  query: string,
  candidates: IRNode[]
): Promise<string[] | null> {
  const catalog = candidates
    .map((node, index) => {
      const label = getIRTypeLabel(node.kind, node.subtype);
      return `${index}. [${label} · ${node.status}] ${node.title}${
        snippet(node) ? ` — ${snippet(node)}` : ""
      }`;
    })
    .join("\n");

  const prompt = `You are a search ranker for a decision/reasoning workspace. Given a user's query and a numbered catalog of items, return the indices of the items that are semantically relevant to the query, most relevant first.

Rules:
- Match on meaning, not just keywords.
- Include only genuinely relevant items (it's fine to return few or none).
- Return at most ${MAX_RESULTS} indices.
- Respond with ONLY a JSON array of integers (e.g. [3,0,7]). No prose.

Query: ${query}

Catalog:
${catalog}`;

  try {
    const { text } = await generateText({
      model: getTitleModel(),
      prompt,
      temperature: 0,
    });

    const match = text.match(/\[[\d\s,]*\]/);
    if (!match) {
      return null;
    }

    const indices = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(indices)) {
      return null;
    }

    const ids: string[] = [];
    for (const value of indices) {
      const index = typeof value === "number" ? value : Number(value);
      const node = Number.isInteger(index) ? candidates[index] : undefined;
      if (node && !ids.includes(node.id)) {
        ids.push(node.id);
      }
    }
    return ids;
  } catch (error) {
    console.error("Semantic search ranking failed", error);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const input = bodySchema.parse(await request.json());
    const candidates = await loadCandidates(session.user.id, input.projectId);

    if (candidates.length === 0) {
      return Response.json({ mode: "semantic", results: [] });
    }

    const rankedIds = await rankWithModel(input.query, candidates);

    if (rankedIds) {
      const byId = new Map(candidates.map((node) => [node.id, node]));
      const results = rankedIds
        .map((id) => byId.get(id))
        .filter((node): node is IRNode => Boolean(node));
      return Response.json({ mode: "semantic", results });
    }

    // Fallback: deterministic keyword match so search still works when the
    // model is unavailable (e.g. missing API key) or returns nothing usable.
    const lists = await Promise.all(
      SEARCH_STATUSES.map((status) =>
        listIRNodesForUser({
          userId: session.user.id,
          projectId: input.projectId,
          status,
          query: input.query,
        })
      )
    );
    return Response.json({
      mode: "keyword",
      results: lists.flat().slice(0, MAX_RESULTS),
    });
  } catch (error) {
    return irErrorToResponse(error, "IR search failed");
  }
}
