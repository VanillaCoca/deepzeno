import "server-only";

// Watchtower patrol engine (L3 sentinel tier). One patrol re-verifies one
// watched node's external grounding: rerun (or regenerate) a couple of search
// intents, refetch the pages behind existing evidence, extract fresh
// quote-verified items, and compare. A signal that clears the alert-scarcity
// gates lands as ONE pending open_question candidate carrying the
// contradicting evidence — never a truth write, never a status change
// (Iron Law 0/4; v1 rules §6.4: only the user can declare an assumption dead).

import { z } from "zod";
import { generateObjectResilient } from "@/lib/ai/resilient-generate";
import type { ModelsUsedAccumulator } from "@/lib/billing/cost-core";
import { addUsage, computeCostEstimate } from "@/lib/billing/cost-core";
import {
  loadUserFunding,
  requireFunding,
  settleUsage,
  type UserFunding,
  withUserFunding,
} from "@/lib/billing/funding";
import { stripInlineMarkers } from "@/lib/ir/marker-syntax";
import {
  createIRNodeForUser,
  getIRNodeForUser,
  logIREvent,
} from "@/lib/ir/queries";
import { extractEvidenceItems } from "./extract";
import { fetchPageText } from "./fetch-page";
import {
  DEFAULT_RESEARCH_MODEL_ID,
  normalizeResearchModelId,
} from "./model-preference";
import {
  computeNextDueAt,
  evaluatePatrolSignal,
  nextQuietPatrols,
  type PatrolOutcome,
  patrolIntervalDays,
  resolvePatrolBudget,
  shouldAlert,
} from "./patrol-core";
import {
  createResearchRun,
  insertEvidence,
  listEvidenceForNode,
  listResearchRunsForNode,
  updateResearchRun,
} from "./queries";
import type { RunReporter } from "./run-reporter";
import { createRunReporter, RunCancelledError } from "./run-reporter";
import { searchWeb } from "./search";
import { scoreSource } from "./source-score";
import { verifyQuote } from "./text";
import {
  countRecentWatchtowerAlerts,
  type ExplorationDirection,
  getProjectAgentSettings,
  getProjectOwnerId,
  getWatchById,
  type IRWatch,
  updateWatch,
} from "./watch-queries";

export type PatrolResult = {
  watchId: string;
  status:
    | "signal_alerted"
    | "signal_suppressed"
    | "quiet"
    | "cancelled"
    | "failed";
  runId: string | null;
  detail: string | null;
};

const patrolIntentSchema = z.object({
  intents: z
    .array(
      z.object({ query: z.string().min(3).max(200), goal: z.string().max(300) })
    )
    .min(1)
    .max(2),
});

function isPlanIntentArray(
  value: unknown
): value is Array<{ query: string; goal?: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { query?: unknown }).query === "string"
    )
  );
}

// Reuse the persisted plan from the node's most recent completed run —
// which, after a patrol has visited once, is that patrol's proposed
// next_directions carried through the watch — otherwise generate 1-2 fresh
// intents on the patrol model.
async function resolveIntents({
  watch,
  nodeTitle,
  preferredModelId,
  maxSearches,
  modelsUsed,
}: {
  watch: IRWatch;
  nodeTitle: string;
  preferredModelId: string | null;
  maxSearches: number;
  modelsUsed: ModelsUsedAccumulator;
}): Promise<ExplorationDirection[]> {
  // A previous patrol's proposed directions take precedence: they were
  // written specifically as "what to try NEXT" for this watch.
  if (watch.nextDirections && watch.nextDirections.length > 0) {
    return watch.nextDirections.slice(0, maxSearches);
  }

  const runs = await listResearchRunsForNode({
    nodeId: watch.nodeId,
    limit: 5,
  });
  const donePlan = runs.find(
    (run) =>
      (run.status === "done" || run.status === "partial") &&
      isPlanIntentArray(run.plan)
  )?.plan;

  if (isPlanIntentArray(donePlan)) {
    return donePlan
      .slice(0, maxSearches)
      .map((intent) => ({ query: intent.query, goal: intent.goal ?? "" }));
  }

  const result = await generateObjectResilient({
    task: "research_plan",
    system:
      'Generate the sharpest web-search queries to re-verify whether an assumption still holds today; prefer recency-sensitive phrasing. Respond with a JSON object: {"intents": [{"query": "...", "goal": "..."}]}.',
    prompt: `## Watched assumption\n${nodeTitle}\n\nGenerate up to ${maxSearches} search queries that would reveal whether this assumption has been overturned recently. Return them as JSON.`,
    schema: patrolIntentSchema,
    preferredModelId,
  });
  // Bill the model that actually answered, not the one that was asked for:
  // `generateObjectResilient` silently falls back on a tripped breaker, and
  // attributing the spend to the requested model would hide the degradation
  // in exactly the number used to ration.
  addUsage(modelsUsed, result.modelId, result.usage);
  return result.object.intents.slice(0, maxSearches);
}

const nextDirectionsSchema = z.object({
  directions: z
    .array(
      z.object({ query: z.string().min(3).max(200), goal: z.string().max(300) })
    )
    .min(2)
    .max(4),
});

// Propose fresh exploration angles for the NEXT patrol visit — the
// "human-like research directions" surfaced on the hypothesis board.
// Best-effort: returns undefined on any failure so a patrol never fails
// because direction generation did.
async function generateNextDirections({
  nodeTitle,
  priorDirections,
  signalKind,
  preferredModelId,
  modelsUsed,
}: {
  nodeTitle: string;
  priorDirections: ExplorationDirection[];
  signalKind: string | null;
  preferredModelId: string | null;
  modelsUsed: ModelsUsedAccumulator;
}): Promise<ExplorationDirection[] | undefined> {
  try {
    const prior = priorDirections
      .map((direction) => `- ${direction.query}`)
      .join("\n");
    const result = await generateObjectResilient({
      task: "research_plan",
      system:
        'You are a curious human researcher keeping standing watch over one assumption. Propose 2-4 concrete exploration angles for your NEXT visit: at least one reverse-validation angle (actively hunt for counterexamples or evidence AGAINST the assumption), and prefer adjacent signals (ecosystem moves, competitors, upstream policy or data shifts) or one bold-but-checkable hunch over rerunning obvious queries. Never repeat a prior angle. Write each goal in the same language as the assumption title. Respond with a JSON object: {"directions": [{"query": "web search query", "goal": "what this angle would reveal"}]}.',
      prompt: `## Watched assumption\n${nodeTitle}\n\n## Angles already tried\n${prior || "(none)"}\n\n## Last visit outcome\n${signalKind ? `signal detected: ${signalKind}` : "quiet — nothing new found"}\n\nPropose the next exploration directions as JSON.`,
      schema: nextDirectionsSchema,
      preferredModelId,
    });
    addUsage(modelsUsed, result.modelId, result.usage);
    return result.object.directions.slice(0, 4);
  } catch {
    // Tokens spent on a call that then failed to parse are still spent, but
    // the resilient wrapper does not hand back usage on the throw path, so
    // there is nothing to record. Undercounting here is bounded by one call.
    return undefined;
  }
}

/**
 * Public entry point for both callers (the daily cron sweep and "patrol now").
 *
 * The try/catch is the contract, not defensive habit. The sweep runs patrols in
 * parallel lanes over one `Promise.all`, where a single rejected promise takes
 * every other lane in flight down with it — one unreadable watch row would cost
 * the whole day's sweep for every tenant. Enforcing it here rather than at the
 * call site is deliberate: "patrol now" would otherwise be the caller that
 * forgets, and the guarantee belongs to the function that promises a
 * `PatrolResult`, not to whoever happens to call it.
 */
export async function runPatrolForWatch({
  watchId,
}: {
  watchId: string;
}): Promise<PatrolResult> {
  try {
    return await fundAndRunPatrol(watchId);
  } catch (error) {
    // Everything that can reach here — watch lookup, owner lookup, key
    // decryption — happens before a run row exists, so there is no row to
    // record it on. Returning it as a failed result at least lands it in the
    // sweep log beside the patrols that did run, instead of vanishing.
    return {
      watchId,
      status: "failed",
      runId: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Answers "whose money is this" before any of it is spent.
 *
 * A patrol runs with no request in flight, so nothing else in the process would
 * install the owner's keys — without this every patrol in the system would
 * quietly bill the operator, on the one cost that recurs forever without anyone
 * pressing anything. Wrapping the cron loop instead would have left "patrol
 * now" unfunded, which is the same bug with a smaller blast radius.
 */
async function fundAndRunPatrol(watchId: string): Promise<PatrolResult> {
  const watch = await getWatchById(watchId);
  if (!watch) {
    return {
      watchId,
      status: "failed",
      runId: null,
      detail: "watch not found",
    };
  }

  const ownerId = await getProjectOwnerId(watch.projectId);
  if (!ownerId) {
    await rescheduleWatch(watch, "failed");
    return {
      watchId,
      status: "failed",
      runId: null,
      detail: "project owner missing",
    };
  }

  const funding = await loadUserFunding(ownerId);

  // Hoisted above `withUserFunding` so the ledger write below sees whatever
  // was spent, including on the paths that throw. A patrol that dies halfway
  // has still spent money; charging only the patrols that succeed is an
  // allowance with a hole in it shaped exactly like the failure-prone path.
  const modelsUsed: ModelsUsedAccumulator = {};

  const result = await withUserFunding(funding, () =>
    executePatrol({ watch, ownerId, funding, modelsUsed })
  );

  await settleUsage({
    funding,
    modelsUsed,
    kind: "patrol",
    projectId: watch.projectId,
    runId: result.runId,
  }).catch((error) => {
    // The run row already carries the same cost figures, so a failed ledger
    // write loses the allowance accounting, not the record. Loud, because
    // silently under-charging is how a free tier becomes an unbounded one.
    console.error("Failed to settle patrol usage", {
      watchId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return result;
}

// Reschedule regardless of outcome — a failing patrol must not wedge the
// queue. Module-level because the owner-missing path above needs it before the
// engine has been entered.
//
// The outcome is a required argument rather than a default, because it is the
// only thing that decides how long the next wait is, and a default would make
// "I forgot to say" indistinguishable from "nothing happened" — which is the
// difference between a watch that keeps its cadence and one that backs off to
// monthly on a run of provider errors.
function rescheduleWatch(
  watch: IRWatch,
  outcome: PatrolOutcome,
  patch: Partial<Parameters<typeof updateWatch>[0]> = {},
  now: Date = new Date()
) {
  const quietPatrols = nextQuietPatrols(watch.quietPatrols, outcome);
  return updateWatch({
    id: watch.id,
    lastPatrolAt: now.toISOString(),
    quietPatrols,
    nextDueAt: computeNextDueAt(watch.cadence, now, quietPatrols).toISOString(),
    ...patch,
  }).catch(() => {
    // Best-effort; the due-list ordering self-heals.
  });
}

async function executePatrol({
  watch,
  ownerId,
  funding,
  modelsUsed,
}: {
  watch: IRWatch;
  ownerId: string;
  funding: UserFunding;
  modelsUsed: ModelsUsedAccumulator;
}): Promise<PatrolResult> {
  const watchId = watch.id;
  const now = new Date();
  const budget = resolvePatrolBudget();

  const reschedule = async (
    outcome: PatrolOutcome,
    patch: Partial<Parameters<typeof updateWatch>[0]> = {}
  ) => {
    await rescheduleWatch(watch, outcome, patch, now);
  };

  // Hoisted out of the try so the catch below can settle the run row. Without
  // this a patrol that throws leaves its row `running` forever, and nothing
  // ever corrects it — the exact condition the activity bar has to report as
  // "lost contact" instead of quietly spinning.
  let runId: string | null = null;
  let reporter: RunReporter | null = null;

  // Every terminal path settles the row with the same two cost fields.
  // Routing them through one helper is what stops "the run that failed" from
  // being the one run whose spend goes unrecorded — an allowance that only
  // counts successful patrols is an allowance with a hole in it, and the hole
  // is exactly the retry-heavy path.
  const settleRun = (
    id: string,
    patch: Omit<
      Parameters<typeof updateResearchRun>[0],
      "id" | "modelsUsed" | "costEstimate"
    >
  ) =>
    updateResearchRun({
      id,
      modelsUsed,
      costEstimate: computeCostEstimate(modelsUsed),
      ...patch,
    });

  try {
    const node = await getIRNodeForUser({ id: watch.nodeId, userId: ownerId });
    if (!node) {
      await reschedule("failed");
      return { watchId, status: "failed", runId: null, detail: "node missing" };
    }

    const settings = await getProjectAgentSettings(watch.projectId).catch(
      () => null
    );
    const preferredModelId = normalizeResearchModelId(
      watch.modelId ?? settings?.researchModelId ?? null
    );

    const run = await createResearchRun({
      projectId: watch.projectId,
      topicId: node.topicId,
      originNodeId: watch.nodeId,
      budget,
      runType: "patrol",
      watchId: watch.id,
    });
    runId = run.id;

    // Checked after the run row exists, not before, and that ordering is the
    // point. A patrol refused for lack of funds happens inside a cron with
    // nobody watching; if it returned early the only trace would be a line in
    // a log the user cannot read, and the watch would look like it had simply
    // found nothing — the most expensive silence in the product, because the
    // user reads it as reassurance. Throwing here lands it on the run row as a
    // failure with the allowance sentence attached, in the same place every
    // other run outcome appears. The cost is one row per skipped patrol,
    // bounded by the sweep cap and only while the allowance is exhausted.
    requireFunding(funding, preferredModelId ?? DEFAULT_RESEARCH_MODEL_ID);

    reporter = createRunReporter({
      runId: run.id,
      budget,
      costEstimate: () => computeCostEstimate(modelsUsed),
    });
    await reporter.beat({ phase: "plan" });

    const priorEvidence = await listEvidenceForNode({
      nodeId: watch.nodeId,
      limit: 20,
    });

    // ── Collect: search + refetch prior sources, extract fresh items ──────
    const intents = await resolveIntents({
      watch,
      nodeTitle: node.title,
      preferredModelId,
      maxSearches: budget.maxSearches,
      modelsUsed,
    });

    // Persist the plan BEFORE searching: a patrol that dies mid-run still
    // shows which angles it was pursuing on the exploration board.
    await updateResearchRun({ id: run.id, plan: intents }).catch(() => {
      // Plan persistence is observability, never a reason to fail a patrol.
    });

    await reporter.beat({
      phase: "collect",
      searchesUsed: 0,
      fetchesUsed: 0,
    });

    const urls = new Map<string, string | null>();
    let searchesUsed = 0;
    for (const intent of intents.slice(0, budget.maxSearches)) {
      try {
        const outcome = await searchWeb(intent.query);
        for (const result of outcome.results) {
          if (!urls.has(result.url)) {
            urls.set(result.url, result.title);
          }
        }
      } catch {
        // A failed search is a quiet miss, not a failed patrol.
      }
      searchesUsed++;
      await reporter.beat({
        phase: "collect",
        searchesUsed,
        fetchesUsed: 0,
      });
    }
    // Prior evidence pages first (quote-vanish detection), then new URLs.
    const priorUrls = [...new Set(priorEvidence.map((item) => item.url))];
    const fetchOrder = [
      ...priorUrls,
      ...[...urls.keys()].filter((url) => !priorUrls.includes(url)),
    ].slice(0, budget.maxFetches);

    const refetchedPages: Array<{ url: string; text: string }> = [];
    const freshItems: Array<{
      quote: string;
      claim: string;
      stance: "supports" | "contradicts" | "neutral";
      url: string;
      title: string | null;
    }> = [];
    let fetchesUsed = 0;
    for (const url of fetchOrder) {
      const page = await fetchPageText(url);
      if (!page) {
        continue;
      }
      refetchedPages.push({ url, text: page.text });
      fetchesUsed++;
      await reporter.beat({
        phase: "collect",
        searchesUsed,
        fetchesUsed,
        evidence: freshItems.length,
      });
      try {
        const extraction = await extractEvidenceItems({
          preferredModelId,
          originQuestion: `Is this assumption still true today? ${node.title}`,
          url,
          pageText: page.text,
        });
        addUsage(modelsUsed, extraction.modelId, extraction.usage);
        for (const item of extraction.items) {
          if (verifyQuote(item.quote, page.text)) {
            freshItems.push({ ...item, url, title: urls.get(url) ?? null });
          }
        }
      } catch (error) {
        // A patrol that cannot extract is a patrol that reports "nothing
        // changed" — the most expensive silence in the product, because the
        // user reads it as reassurance. Quiet for the run, loud in the logs.
        console.warn(
          JSON.stringify({
            type: "extraction_failed",
            runId: run.id,
            url,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }

    // ── Evaluate ──────────────────────────────────────────────────────────
    await reporter.beat({ phase: "judge", evidence: freshItems.length });

    const signal = evaluatePatrolSignal({
      newItems: freshItems,
      priorEvidence,
      refetchedPages,
    });

    // Propose where to look next, whatever the outcome — a quiet patrol is
    // exactly when a fresh angle matters most. Undefined on failure, in
    // which case the watch keeps its existing directions.
    const nextDirections = await generateNextDirections({
      nodeTitle: node.title,
      priorDirections: intents,
      signalKind: signal.signal ? signal.kind : null,
      preferredModelId,
      modelsUsed,
    });
    const directionsPatch = nextDirections ? { nextDirections } : {};

    if (!signal.signal) {
      await settleRun(run.id, {
        status: "done",
        finishedAt: new Date().toISOString(),
      });
      await reschedule("quiet", directionsPatch);
      const quietPatrols = nextQuietPatrols(watch.quietPatrols, "quiet");
      await logIREvent({
        projectId: watch.projectId,
        topicId: node.topicId,
        nodeId: watch.nodeId,
        event: "patrol_quiet",
        layer: "watchtower",
        // The backoff travels with the event that causes it. A watch drifting
        // from daily to monthly over three months is invisible in any single
        // row; the only place the drift is legible is the event stream, and
        // only if each step says where it landed.
        metadata: {
          runId: run.id,
          watchId: watch.id,
          quietPatrols,
          intervalDays: patrolIntervalDays(watch.cadence, quietPatrols),
        },
      }).catch(() => {
        // Observability must never fail the patrol.
      });
      return { watchId, status: "quiet", runId: run.id, detail: null };
    }

    // ── Alert scarcity gates ──────────────────────────────────────────────
    const weeklyAlertCount = await countRecentWatchtowerAlerts(watch.projectId);
    const admit = shouldAlert({
      lastAlertAt: watch.lastAlertAt,
      cooldownDays: budget.alertCooldownDays,
      weeklyAlertCount,
      weeklyCap: budget.weeklyAlertCap,
      now,
    });

    if (!admit) {
      await settleRun(run.id, {
        status: "done",
        finishedAt: new Date().toISOString(),
      });
      await reschedule("signal", {
        lastSignalAt: now.toISOString(),
        ...directionsPatch,
      });
      await logIREvent({
        projectId: watch.projectId,
        topicId: node.topicId,
        nodeId: watch.nodeId,
        event: "patrol_signal_suppressed",
        layer: "watchtower",
        metadata: { runId: run.id, watchId: watch.id, kind: signal.kind },
      }).catch(() => {
        // Observability must never fail the patrol.
      });
      return {
        watchId,
        status: "signal_suppressed",
        runId: run.id,
        detail: signal.detail,
      };
    }

    // ── Land: evidence + ONE pending open_question alert candidate ────────
    const retrievedAt = new Date().toISOString();
    const contradicting = freshItems.filter(
      (item) => item.stance === "contradicts"
    );
    const toPersist = (contradicting.length > 0 ? contradicting : freshItems)
      .slice(0, 6)
      .map((item) => ({
        projectId: watch.projectId,
        runId: run.id,
        nodeId: watch.nodeId,
        url: item.url,
        title: item.title,
        quote: item.quote,
        claim: item.claim,
        stance: item.stance,
        sourceScore: scoreSource(item.url).score,
        retrievedAt,
      }));
    // `report`, not `beat`: the signal is already found and paid for.
    await reporter.report({
      phase: "land",
      evidence: toPersist.length,
      candidates: 1,
    });

    await insertEvidence(toPersist);

    // Stripped, not rejected. The title being templated here is one that is
    // already stored, so it predates the guard at the extraction sites and may
    // still be marker text. Left alone it would multiply: one polluted node
    // seeds a polluted alert on every patrol that fires against it. Dropping
    // the alert instead would throw away a real signal to punish an old typo.
    const subject = stripInlineMarkers(node.title);
    const alertTitle =
      signal.kind === "quote_vanished"
        ? `${subject} — 原始依据页面已变化,该前提是否仍成立?`
        : `${subject} — 发现相反信号,该前提是否仍成立?`;

    const alert = await createIRNodeForUser({
      userId: ownerId,
      projectId: watch.projectId,
      topicId: node.topicId,
      kind: "open_question",
      title: alertTitle.slice(0, 200),
      content: signal.detail,
      rationale:
        signal.kind === "quote_vanished"
          ? "Watchtower 巡检发现:先前支撑此前提的原文引述已从来源页面消失。"
          : "Watchtower 巡检发现:新抓取的证据与此前提相矛盾。",
      sourceLayer: "watchtower",
      createdBy: "ai",
      initialStatus: "pending",
      relations: [
        {
          relation: "contradicts",
          toNode: watch.nodeId,
          label: "巡检发现新信号",
        },
      ],
    });

    await settleRun(run.id, {
      status: "done",
      brief: `Patrol signal (${signal.kind}): ${signal.detail ?? ""}`.slice(
        0,
        6000
      ),
      finishedAt: new Date().toISOString(),
    });
    await reschedule("signal", {
      lastSignalAt: now.toISOString(),
      lastAlertAt: now.toISOString(),
      ...directionsPatch,
    });
    await logIREvent({
      projectId: watch.projectId,
      topicId: node.topicId,
      nodeId: watch.nodeId,
      event: "patrol_alert_created",
      layer: "watchtower",
      metadata: {
        runId: run.id,
        watchId: watch.id,
        kind: signal.kind,
        alertNodeId: alert.id,
      },
    }).catch(() => {
      // Observability must never fail the patrol.
    });

    return {
      watchId,
      status: "signal_alerted",
      runId: run.id,
      detail: signal.detail,
    };
  } catch (error) {
    await reschedule("failed");
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = error instanceof RunCancelledError;

    // Settle the row. Previously this path left it `running` forever, so a
    // patrol that threw stayed on screen as work in flight that no longer
    // existed — a progress bar's worst failure mode.
    if (runId) {
      await settleRun(runId, {
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? null : message,
        finishedAt: new Date().toISOString(),
      }).catch(() => {
        // Best-effort: the activity bar's staleness rule covers what this misses.
      });
    }

    return {
      watchId,
      status: cancelled ? "cancelled" : "failed",
      runId,
      detail: cancelled ? null : message,
    };
  }
}
