import "server-only";

// Watchtower patrol engine (L3 sentinel tier). One patrol re-verifies one
// watched node's external grounding: rerun (or regenerate) a couple of search
// intents, refetch the pages behind existing evidence, extract fresh
// quote-verified items, and compare. A signal that clears the alert-scarcity
// gates lands as ONE pending open_question candidate carrying the
// contradicting evidence — never a truth write, never a status change
// (Iron Law 0/4; v1 rules §6.4: only the user can declare an assumption dead).

import { z } from "zod";
import { selectModelForTask } from "@/lib/ai/model-policy";
import { generateObjectResilient } from "@/lib/ai/resilient-generate";
import {
  createIRNodeForUser,
  getIRNodeForUser,
  logIREvent,
} from "@/lib/ir/queries";
import { extractEvidenceItems } from "./extract";
import { fetchPageText } from "./fetch-page";
import { normalizeResearchModelId } from "./model-preference";
import {
  computeNextDueAt,
  evaluatePatrolSignal,
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
}: {
  watch: IRWatch;
  nodeTitle: string;
  preferredModelId: string | null;
  maxSearches: number;
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
}: {
  nodeTitle: string;
  priorDirections: ExplorationDirection[];
  signalKind: string | null;
  preferredModelId: string | null;
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
    return result.object.directions.slice(0, 4);
  } catch {
    return undefined;
  }
}

export async function runPatrolForWatch({
  watchId,
}: {
  watchId: string;
}): Promise<PatrolResult> {
  const watch = await getWatchById(watchId);
  if (!watch) {
    return {
      watchId,
      status: "failed",
      runId: null,
      detail: "watch not found",
    };
  }

  const now = new Date();
  const budget = resolvePatrolBudget();

  // Whatever happens below, the watch gets rescheduled — a failing patrol
  // must not wedge the queue.
  const reschedule = async (
    patch: Partial<Parameters<typeof updateWatch>[0]>
  ) => {
    await updateWatch({
      id: watch.id,
      lastPatrolAt: now.toISOString(),
      nextDueAt: computeNextDueAt(watch.cadence, now).toISOString(),
      ...patch,
    }).catch(() => {
      // Rescheduling is best-effort; the due-list ordering self-heals.
    });
  };

  // Hoisted out of the try so the catch below can settle the run row. Without
  // this a patrol that throws leaves its row `running` forever, and nothing
  // ever corrects it — the exact condition the activity bar has to report as
  // "lost contact" instead of quietly spinning.
  let runId: string | null = null;
  let reporter: RunReporter | null = null;

  try {
    const ownerId = await getProjectOwnerId(watch.projectId);
    if (!ownerId) {
      await reschedule({});
      return {
        watchId,
        status: "failed",
        runId: null,
        detail: "project owner missing",
      };
    }

    const node = await getIRNodeForUser({ id: watch.nodeId, userId: ownerId });
    if (!node) {
      await reschedule({});
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
    // Patrol does not accumulate token usage, so it has no running cost to
    // report. Null, not zero — a patrol is not free, it is unmeasured.
    reporter = createRunReporter({
      runId: run.id,
      budget,
      costEstimate: () => null,
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
    const extractModelId =
      preferredModelId ?? selectModelForTask("research_worker");

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
          modelId: extractModelId,
          originQuestion: `Is this assumption still true today? ${node.title}`,
          url,
          pageText: page.text,
        });
        for (const item of extraction.items) {
          if (verifyQuote(item.quote, page.text)) {
            freshItems.push({ ...item, url, title: urls.get(url) ?? null });
          }
        }
      } catch {
        // Extraction failures are quiet misses.
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
    });
    const directionsPatch = nextDirections ? { nextDirections } : {};

    if (!signal.signal) {
      await updateResearchRun({
        id: run.id,
        status: "done",
        finishedAt: new Date().toISOString(),
      });
      await reschedule(directionsPatch);
      await logIREvent({
        projectId: watch.projectId,
        topicId: node.topicId,
        nodeId: watch.nodeId,
        event: "patrol_quiet",
        layer: "watchtower",
        metadata: { runId: run.id, watchId: watch.id },
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
      await updateResearchRun({
        id: run.id,
        status: "done",
        finishedAt: new Date().toISOString(),
      });
      await reschedule({
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

    const alertTitle =
      signal.kind === "quote_vanished"
        ? `${node.title} — 原始依据页面已变化,该前提是否仍成立?`
        : `${node.title} — 发现相反信号,该前提是否仍成立?`;

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

    await updateResearchRun({
      id: run.id,
      status: "done",
      brief: `Patrol signal (${signal.kind}): ${signal.detail ?? ""}`.slice(
        0,
        6000
      ),
      finishedAt: new Date().toISOString(),
    });
    await reschedule({
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
    await reschedule({});
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = error instanceof RunCancelledError;

    // Settle the row. Previously this path left it `running` forever, so a
    // patrol that threw stayed on screen as work in flight that no longer
    // existed — a progress bar's worst failure mode.
    if (runId) {
      await updateResearchRun({
        id: runId,
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
