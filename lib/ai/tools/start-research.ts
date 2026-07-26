import "server-only";

import { tool } from "ai";
import { z } from "zod";
import {
  createIRNodeForUser,
  findDuplicateIRCandidate,
  getIRNodeForUser,
  logIREvent,
} from "@/lib/ir/queries";
import { listResearchRunsForNode } from "@/lib/research/queries";
import {
  resolveSearchProvider,
  SEARCH_PROVIDER_MISSING_MESSAGE,
} from "@/lib/research/search-provider";
import {
  CHAT_RESEARCH_BUDGET,
  CHAT_RESEARCH_RUNS_PER_TURN,
  hasLiveRun,
  isResearchableKind,
  normalizeResearchQuestion,
  RESEARCH_QUESTION_MAX_LENGTH,
  type StartResearchDeclineReason,
} from "./start-research-core";

/**
 * The chat model's own handle on ZENO's L2 research layer.
 *
 * Before this existed, the model was telling the truth when it said it could
 * not check the live web — `searchWeb` was reachable only from the research and
 * patrol pipelines, and `streamText` was called with no tools at all. That
 * isolation is correct and stays: chat is where judgments are made, research is
 * where evidence is made, and letting a chat turn splice raw web text into an
 * assertion would walk straight past evidence → candidate → confirm (Iron Law
 * 3). What was wrong was the degradation. The model's honest "I can't" came
 * with advice to go use a coding agent or a search tool — routing the user out
 * of the product when the capability was one node away, inside it.
 *
 * So this tool does not give chat the web. It gives chat a doorbell for the
 * layer that already has it. The model starts a run and gets back a run
 * reference; the evidence lands in the judgment inbox, the progress lands in
 * the activity bar, and the model has learned nothing it could assert.
 *
 * How the run leaves this request is the part that had to be got right and was
 * not. The first version ran the pipeline in the chat route's own `after()`
 * tail, which looked detached and was not: `after()` executes inside the same
 * invocation as the response, so a four-minute pipeline was handed whatever
 * was left of the route's ceiling once the model had finished writing its
 * answer. A long answer left it almost nothing, and the run died mid-collect
 * with its row still saying `running` — a run the user could watch but never
 * get.
 *
 * So the tool does not run anything. It posts to `/api/research/run` on this
 * same deployment, carrying the caller's own cookies, and that request gets
 * its own invocation with its own untouched 300 seconds. The hop costs a round
 * trip and buys the one thing the run needs, which is a clock nobody else is
 * spending. It also means chat and the research panel now start runs through
 * exactly one code path — the one that was already proven to finish.
 */
export type StartResearchResult =
  | {
      status: "started";
      run_on_node: string;
      question: string;
      budget: { max_searches: number; max_fetches: number };
      /** Read by the model, not by a human. */
      note: string;
    }
  | {
      status: "declined";
      reason: StartResearchDeclineReason;
      message: string;
    };

const DECLINE_MESSAGES: Record<StartResearchDeclineReason, string> = {
  empty_question:
    "The question was empty, or it was IR marker syntax rather than a plain question. Pass the question itself as prose.",
  question_too_long: `The question must be at most ${RESEARCH_QUESTION_MAX_LENGTH} characters. Ask one narrower question.`,
  turn_limit:
    "A research run has already been started in this turn. Only one runs per turn — tell the user which question you researched, and offer to take the next one in their next message.",
  node_not_researchable:
    "That node id is not an open question or hypothesis in this project. Call again with the `question` argument only, and a new open question will be created for it.",
  node_busy:
    "This question already has a research run in flight. Tell the user it is already running; the activity bar shows its progress.",
  search_unavailable: SEARCH_PROVIDER_MISSING_MESSAGE,
  allowance_exhausted:
    "This month's free research allowance is used up, so the run did not start. Tell the user this plainly and tell them the fix: they can connect their own provider API key in Settings and keep going at cost, or wait for next month. Do not present anything as researched.",
  start_failed:
    "The run could not be started. Tell the user plainly that research did not start; do not present anything as researched.",
};

const STARTED_NOTE =
  "The run is now going in the background. You do NOT have its results and will not receive them in this conversation — do not state, guess, or preview any finding. Tell the user what you sent to research and that progress shows in the activity bar, with evidence and candidates arriving in the judgment inbox for their confirmation. Then continue with whatever you can reason about without live data.";

function decline(reason: StartResearchDeclineReason): StartResearchResult {
  return { status: "declined", reason, message: DECLINE_MESSAGES[reason] };
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Hand the run to its own invocation and report whether it was taken.
 *
 * The cookies are forwarded rather than replaced with a service token on
 * purpose. A shared secret would let this path start a run as anyone, which is
 * a privilege the chat model has no business holding; the user's own session
 * gives it exactly the reach the user already had, and the run route
 * authenticates it the same way it authenticates the research panel.
 */
async function dispatchResearchRun({
  origin,
  cookie,
  nodeId,
}: {
  origin: string;
  cookie: string;
  nodeId: string;
}): Promise<
  | { ok: true; runId: string | null }
  | { ok: false; reason: StartResearchDeclineReason }
> {
  const response = await fetch(
    new URL(`${BASE_PATH}/api/research/run`, origin),
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        node_id: nodeId,
        max_searches: CHAT_RESEARCH_BUDGET.maxSearches,
        max_fetches: CHAT_RESEARCH_BUDGET.maxFetches,
      }),
    }
  );

  if (!response.ok) {
    console.error("Research run dispatch rejected", {
      nodeId,
      status: response.status,
      body: await response.text().catch(() => "<unreadable>"),
    });
    // 402 is the one rejection that is not a malfunction, and the model has to
    // be able to tell the user which of the two happened — everything else here
    // is "it broke", this one is "you hit the limit, here is the lever".
    return {
      ok: false,
      reason:
        response.status === 402 ? "allowance_exhausted" : "start_failed",
    };
  }

  const payload = (await response.json().catch(() => null)) as {
    run?: { id?: unknown };
  } | null;
  const runId = payload?.run?.id;

  return { ok: true, runId: typeof runId === "string" ? runId : null };
}

export function createStartResearchTool({
  userId,
  projectId,
  topicId,
  conversationId,
  origin,
  cookie,
}: {
  userId: string;
  projectId: string;
  topicId: string;
  conversationId: string;
  /** Origin of the request being served, so the run route is this deployment. */
  origin: string;
  /** The caller's cookie header, forwarded so the run runs as them. */
  cookie: string;
}) {
  // Per-turn, not per-user: the closure lives exactly as long as one assistant
  // turn, which is the unit the cap is actually about. `stopWhen:
  // stepCountIs(5)` means the model gets up to five steps, so without this a
  // single message could fire five runs into one 300s tail.
  let launched = 0;

  return tool({
    description:
      "Start a background web research run on one factual question. Use it when the answer depends on facts outside your training data that change over time — current prices, what a competitor actually shipped, whether a regulation still applies, what a library's current API is — AND the user's judgment turns on that answer. The run happens in ZENO's research layer, not here: it returns immediately with a reference, and its evidence arrives later in the user's judgment inbox. You will not see the results, so never speak as though you have them. Do not use it for opinions, definitions, arithmetic, anything already in the project context, or when the user is thinking out loud.",
    inputSchema: z.object({
      question: z
        .string()
        .describe(
          "The single factual question to research, as plain prose in the user's language. Self-contained — the research agent does not see this conversation. No IR marker syntax."
        ),
      rationale: z
        .string()
        .optional()
        .describe(
          "Why this needs live evidence rather than your own knowledge, in one sentence. Stored on the question node."
        ),
      node_id: z
        .string()
        .optional()
        .describe(
          'Optional. The id of an existing open question or hypothesis in this project (e.g. "Q7") that this question already is. Pass it when the graph already holds the question, so the evidence lands on the real node instead of a near-duplicate.'
        ),
    }),
    execute: async ({
      question,
      rationale,
      node_id,
    }): Promise<StartResearchResult> => {
      if (launched >= CHAT_RESEARCH_RUNS_PER_TURN) {
        return decline("turn_limit");
      }

      // Pre-flight before anything is written. This check is pure env
      // inspection and costs nothing, and the alternative is a minted node
      // plus a `failed` run row for a deployment that was never going to be
      // able to search — a failure the user would find in the activity bar
      // instead of in the answer that caused it.
      if (!resolveSearchProvider()) {
        return decline("search_unavailable");
      }

      try {
        let node = node_id
          ? await getIRNodeForUser({ id: node_id, userId }).catch(() => null)
          : null;

        if (node_id && !(node && node.projectId === projectId)) {
          return decline("node_not_researchable");
        }

        if (node && !isResearchableKind(node.kind)) {
          return decline("node_not_researchable");
        }

        if (!node) {
          const normalized = normalizeResearchQuestion(question);

          if (!normalized.ok) {
            return decline(normalized.reason);
          }

          // Same dedup the inline-marker path uses. A user who asks the same
          // thing twice should get one question in the graph with two runs
          // against it, not two questions that each know half the evidence.
          const duplicate = await findDuplicateIRCandidate({
            projectId,
            kind: "open_question",
            subtype: null,
            title: normalized.question,
          });

          node =
            duplicate ??
            (await createIRNodeForUser({
              userId,
              projectId,
              topicId,
              kind: "open_question",
              subtype: null,
              title: normalized.question,
              content: normalized.question,
              rationale: rationale?.trim() || null,
              sourceChatId: conversationId,
              // `inline` is the honest layer here: this node exists because the
              // chat model produced it during a chat turn, which is exactly
              // what that layer means. It is not `research` — research did not
              // ask this question, it was handed it.
              sourceLayer: "inline",
              createdBy: "ai",
              // Pending, never idea: the question goes to the judgment inbox
              // like every other thing the model proposes. Starting research on
              // it does not promote it, and the user can still dismiss the
              // question after the evidence lands.
              initialStatus: "pending",
              extractionConfidence: 0.9,
            }));
        }

        const originNodeId = node.id;
        const recentRuns = await listResearchRunsForNode({
          nodeId: originNodeId,
          limit: 5,
        });

        if (hasLiveRun(recentRuns, Date.now())) {
          return decline("node_busy");
        }

        // Awaited, not detached. The run route answers as soon as it has
        // created the row, so this costs one round trip — and in exchange the
        // tool result says "started" only when something actually started.
        // Announcing a run that was never accepted is the silent-miss failure
        // Iron Law 2 does not excuse.
        const dispatched = await dispatchResearchRun({
          origin,
          cookie,
          nodeId: originNodeId,
        });

        if (!dispatched.ok) {
          return decline(dispatched.reason);
        }

        launched += 1;

        await logIREvent({
          projectId,
          topicId,
          nodeId: originNodeId,
          event: "research_run_requested",
          layer: "inline",
          metadata: {
            trigger: "chat_tool",
            conversationId,
            runId: dispatched.runId,
            budget: CHAT_RESEARCH_BUDGET,
            mintedNode: !node_id,
          },
        });

        return {
          status: "started",
          run_on_node: originNodeId,
          question: node.title,
          budget: {
            max_searches: CHAT_RESEARCH_BUDGET.maxSearches,
            max_fetches: CHAT_RESEARCH_BUDGET.maxFetches,
          },
          note: STARTED_NOTE,
        };
      } catch (error) {
        console.error("Could not start a chat-initiated research run", error);
        return decline("start_failed");
      }
    },
  });
}
