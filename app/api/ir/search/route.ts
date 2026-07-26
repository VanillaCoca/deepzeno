import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getTitleModelId } from "@/lib/ai/models";
import { getTitleModel } from "@/lib/ai/providers";
import { addUsage, type ModelsUsedAccumulator } from "@/lib/billing/cost-core";
import {
  fundingForModel,
  loadUserFunding,
  settleUsage,
  withUserFunding,
} from "@/lib/billing/funding";
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
  candidates: IRNode[],
  modelsUsed: ModelsUsedAccumulator
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
    const { text, usage } = await generateText({
      model: getTitleModel(),
      prompt,
      temperature: 0,
    });

    // Recorded before the parse, not after. An unparsable answer still cost
    // 250 catalog rows' worth of input tokens, and the branch that throws them
    // away is exactly the branch a "we only bill what worked" rule would
    // silently exempt.
    addUsage(modelsUsed, getTitleModelId(process.env), usage);

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

    // The one billable path in the product that degrades instead of refusing.
    //
    // Everywhere else an exhausted allowance throws, because there is no
    // cheaper honest version of a research run or a sweep — half a run is not
    // a run. Search is different: a deterministic keyword match over the same
    // rows already exists here as the model-unavailable fallback, and it
    // answers the user's actual question less well rather than not at all.
    // Refusing would be choosing "no search" over "worse search" purely to be
    // consistent with the other routes.
    //
    // What it must not do is degrade quietly. `mode: "keyword"` alone reads as
    // a property of the query; `allowance_exhausted` is what lets the dialog
    // say the ranking was switched off and where the switch is.
    const funding = await loadUserFunding(session.user.id);
    const titleModelId = getTitleModelId(process.env);
    const denied =
      !funding.unmetered &&
      fundingForModel(funding, titleModelId).source === "denied";

    const modelsUsed: ModelsUsedAccumulator = {};
    const rankedIds = denied
      ? null
      : await withUserFunding(funding, () =>
          rankWithModel(input.query, candidates, modelsUsed)
        ).finally(() =>
          settleUsage({
            funding,
            modelsUsed,
            kind: "search",
            projectId: input.projectId,
          }).catch((error) => {
            console.error("Failed to settle search usage", {
              projectId: input.projectId,
              error: error instanceof Error ? error.message : String(error),
            });
          })
        );

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
      allowance_exhausted: denied,
    });
  } catch (error) {
    return irErrorToResponse(error, "IR search failed");
  }
}
