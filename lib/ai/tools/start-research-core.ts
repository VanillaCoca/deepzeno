/**
 * The decisions behind letting the chat model start a research run on its own.
 *
 * Pure and side-effect free so `tests/unit/start-research-core.test.ts` can
 * import it directly; the tool in `start-research.ts` does the database and
 * pipeline work and owes every refusal to a reason defined here.
 *
 * The premise this module exists to make safe: the run fires with NO
 * confirmation card. That follows the project's own rule — 调查全自动，真相确认制，
 * 确认是稀缺资源 — because a research run produces evidence and candidates, not
 * truth, and every one of those still has to pass the judgment inbox. Gating
 * the launch would spend the user's scarce confirmations on a step that
 * creates nothing to confirm.
 *
 * What autonomy does cost is a bounded blast radius, which is what the
 * constants and guards below are:
 *
 *   - a smaller budget than the UI's, because nobody saw a cost estimate;
 *   - one run per conversational turn, because the human sending the next
 *     message is the only rate limit that actually exists;
 *   - no second run on a question already being researched, because that is
 *     pure duplicate spend with no possible new evidence.
 */

import { sanitizeExtractedTitle } from "@/lib/ir/marker-syntax";
import {
  isActiveRunStatus,
  RUN_STALE_SECONDS,
} from "@/lib/research/run-progress-core";

/**
 * The budget a chat-initiated run gets: 3 searches, 5 fetches.
 *
 * Deliberately below the UI default (6/10). The pre-run panel shows a cost
 * anchor and the user clicks anyway; here nobody was asked. Half the ceiling
 * is what makes "fire without asking" a defensible default rather than a way
 * to spend the user's money on their behalf. Still clamped by
 * `clampBudgetOverride` at the pipeline boundary — this is a preference, not
 * a trust boundary.
 */
export const CHAT_RESEARCH_BUDGET = {
  maxSearches: 3,
  maxFetches: 5,
} as const;

/**
 * How many runs one assistant turn may start.
 *
 * One, and not because two would be unaffordable. Two runs land in the same
 * `after()` tail under one 300s invocation ceiling, so the realistic outcome
 * of allowing a burst is that BOTH get killed mid-collect and both report
 * partial. A refusal the model can explain beats two runs that quietly
 * truncate.
 */
export const CHAT_RESEARCH_RUNS_PER_TURN = 1;

/** Matches the inline-marker parser's title bound and the `ir_nodes` column. */
export const RESEARCH_QUESTION_MAX_LENGTH = 200;

/**
 * The only two kinds the research pipeline accepts as an origin.
 *
 * Mirrors the gate in `prepareResearchRun`. Checked here as well so a model
 * that names the wrong node is told why synchronously, instead of the failure
 * disappearing into a detached tail where the only trace is a `failed` run row.
 */
export const RESEARCHABLE_KINDS = ["open_question", "hypothesis"] as const;

export function isResearchableKind(kind: string): boolean {
  return (RESEARCHABLE_KINDS as readonly string[]).includes(kind);
}

export type StartResearchDeclineReason =
  /** The question was blank, or was marker syntax with no prose in it. */
  | "empty_question"
  /** Longer than a node title may be. */
  | "question_too_long"
  /** This turn already started a run. */
  | "turn_limit"
  /** The named node is not this project's, or is not a question/hypothesis. */
  | "node_not_researchable"
  /** A run on this same question is already in flight. */
  | "node_busy"
  /** No web search provider is configured in this deployment. */
  | "search_unavailable"
  /** Everything checked out and the launch itself failed. */
  | "start_failed";

/**
 * Turn whatever the model passed as a question into a node title, or nothing.
 *
 * This is the fifth code path that can write an `ir_nodes.title`, and it gets
 * the same guard as the other four: a title is prose, never the `[[ir:…]]`
 * wire syntax. A model that has just been told about a tool is exactly the
 * model most likely to wrap its argument in the protocol it was taught two
 * paragraphs earlier.
 *
 * Returns null rather than a salvaged approximation when the text is
 * unusable — Iron Law 2. A refused tool call is a miss the model can report;
 * a node titled `[[ir:open_question|` is an error nobody can read.
 */
export function normalizeResearchQuestion(
  raw: string | null | undefined
):
  | { ok: true; question: string }
  | { ok: false; reason: "empty_question" | "question_too_long" } {
  const sanitized = sanitizeExtractedTitle(raw);

  if (!sanitized) {
    return { ok: false, reason: "empty_question" };
  }

  if (sanitized.length > RESEARCH_QUESTION_MAX_LENGTH) {
    return { ok: false, reason: "question_too_long" };
  }

  return { ok: true, question: sanitized };
}

export type RunLivenessInput = {
  status: string;
  createdAt: string;
  progress: { at?: string } | null;
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Is a run on this question actually still going?
 *
 * Status alone is not enough. A run whose invocation was killed leaves its row
 * at `running` forever, and treating that as "busy" would permanently lock the
 * question out of research — the worst possible failure for a guard whose only
 * job is to prevent duplicate spend. So the same staleness rule the activity
 * bar uses applies here: no checkpoint for `RUN_STALE_SECONDS` means lost
 * contact, and lost contact means the question is free again.
 */
export function hasLiveRun(runs: RunLivenessInput[], nowMs: number): boolean {
  return runs.some((run) => {
    if (!isActiveRunStatus(run.status)) {
      return false;
    }

    const lastBeatMs =
      parseTime(run.progress?.at) ?? parseTime(run.createdAt) ?? nowMs;

    return (nowMs - lastBeatMs) / 1000 <= RUN_STALE_SECONDS;
  });
}
