// Pure helpers — no server-only import so node:test can import this directly.
//
// Watchtower patrol logic (spec 2026-06-10-watchtower-l3-design.md, sentinel
// tier): decide when a watch is due, whether re-collected material amounts to
// a signal, and whether a signal may become an alert (alerts are scarce —
// constitution §2a: patrol frequency and alert frequency are decoupled).

import type { IRKind } from "@/lib/ir/types";
import type { PatrolCadence } from "./agent-settings";
import { verifyQuote } from "./text";

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export type PatrolBudget = {
  maxSearches: number;
  maxFetches: number;
  alertCooldownDays: number;
  weeklyAlertCap: number;
  maxWatchesPerSweep: number;
};

function intFromEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number
) {
  const parsed = Number.parseInt(env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Sentinel patrols are deliberately much tighter than L2 research runs.
export function resolvePatrolBudget(
  env: Record<string, string | undefined> = process.env
): PatrolBudget {
  return {
    maxSearches: intFromEnv(env, "ZENO_PATROL_MAX_SEARCHES", 2),
    maxFetches: intFromEnv(env, "ZENO_PATROL_MAX_FETCHES", 3),
    alertCooldownDays: intFromEnv(env, "ZENO_PATROL_ALERT_COOLDOWN_DAYS", 7),
    weeklyAlertCap: intFromEnv(env, "ZENO_PATROL_WEEKLY_ALERT_CAP", 3),
    maxWatchesPerSweep: intFromEnv(env, "ZENO_PATROL_MAX_WATCHES_PER_SWEEP", 8),
  };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 3600 * 1000;

const CADENCE_DAYS: Record<PatrolCadence, number> = {
  daily: 1,
  every_3_days: 3,
  weekly: 7,
};

export function computeNextDueAt(cadence: PatrolCadence, from: Date): Date {
  return new Date(from.getTime() + CADENCE_DAYS[cadence] * DAY_MS);
}

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

export type PatrolEvidenceInput = {
  quote: string;
  claim: string;
  stance: "supports" | "contradicts" | "neutral";
};

export type PriorEvidenceInput = {
  quote: string;
  url: string;
};

export type RefetchedPageInput = {
  url: string;
  text: string;
};

export type PatrolSignal = {
  signal: boolean;
  kind: "new_contradiction" | "quote_vanished" | null;
  detail: string | null;
};

function normalizeQuote(quote: string) {
  return quote.replace(/\s+/g, " ").trim().toLowerCase();
}

// A patrol produces a signal when (a) freshly extracted evidence CONTRADICTS
// the watched node and is not something we already knew, or (b) a previously
// verified verbatim quote no longer appears on its (refetched) source page —
// the original grounding has moved.
export function evaluatePatrolSignal({
  newItems,
  priorEvidence,
  refetchedPages,
}: {
  newItems: PatrolEvidenceInput[];
  priorEvidence: PriorEvidenceInput[];
  refetchedPages: RefetchedPageInput[];
}): PatrolSignal {
  const knownQuotes = new Set(
    priorEvidence.map((item) => normalizeQuote(item.quote))
  );

  const freshContradiction = newItems.find(
    (item) =>
      item.stance === "contradicts" &&
      !knownQuotes.has(normalizeQuote(item.quote))
  );
  if (freshContradiction) {
    return {
      signal: true,
      kind: "new_contradiction",
      detail: freshContradiction.claim,
    };
  }

  const pageByUrl = new Map(
    refetchedPages.map((page) => [page.url, page.text])
  );
  const vanished = priorEvidence.find((item) => {
    const pageText = pageByUrl.get(item.url);
    return pageText !== undefined && !verifyQuote(item.quote, pageText);
  });
  if (vanished) {
    return {
      signal: true,
      kind: "quote_vanished",
      detail: vanished.url,
    };
  }

  return { signal: false, kind: null, detail: null };
}

// ---------------------------------------------------------------------------
// Alert scarcity
// ---------------------------------------------------------------------------

export function shouldAlert({
  lastAlertAt,
  cooldownDays,
  weeklyAlertCount,
  weeklyCap,
  now,
}: {
  lastAlertAt: string | null;
  cooldownDays: number;
  weeklyAlertCount: number;
  weeklyCap: number;
  now: Date;
}): boolean {
  if (weeklyAlertCount >= weeklyCap) {
    return false;
  }
  if (!lastAlertAt) {
    return true;
  }
  return (
    now.getTime() - new Date(lastAlertAt).getTime() >= cooldownDays * DAY_MS
  );
}

// ---------------------------------------------------------------------------
// Auto-suggestion (which nodes deserve a Zeno-initiated watch)
// ---------------------------------------------------------------------------

// Watch-worthiness follows the node's grounding, with kind as a prior (spec):
// hypotheses exist to be falsified; goals/principles/plans are never
// auto-watched (agenda belongs to the user / covered transitively); anything
// else earns a freshness patrol once it carries web evidence.
export function isWatchWorthy({
  kind,
  hasEvidence,
  dependentCount,
}: {
  kind: IRKind;
  hasEvidence: boolean;
  dependentCount: number;
}): boolean {
  if (kind === "goal" || kind === "principle" || kind === "plan") {
    return false;
  }
  if (kind === "hypothesis") {
    return hasEvidence || dependentCount > 0;
  }
  return hasEvidence;
}
