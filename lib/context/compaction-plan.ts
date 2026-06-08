// Pure planning logic for automatic conversation compaction.
//
// No server/provider imports live here so the planning + threshold math can be
// unit-tested in isolation (and so the route can call it cheaply on every turn).
// The actual summary model call lives in `./compaction.ts`.

// Compact when the projected payload would exceed this fraction of the model's
// context window. The remaining headroom absorbs the model's output/reasoning
// tokens plus estimation error.
export const COMPACTION_TRIGGER_RATIO = 0.7;

// Most-recent messages always kept verbatim (recency matters most for coherence).
export const KEEP_RECENT_MESSAGES = 8;

// Don't bother summarizing fewer than this many messages — avoids churning the
// checkpoint on conversations that only just crossed the threshold.
export const MIN_MESSAGES_TO_COMPACT = 6;

// Output cap for the summary model call; also the token cost we plan against for
// the freshly-produced summary block.
export const SUMMARY_MAX_OUTPUT_TOKENS = 1500;

export type CompactionCandidate = {
  id: string;
  tokens: number;
};

export type CompactionPlan = {
  shouldCompact: boolean;
  // Oldest live messages to fold into the (regenerated) summary.
  foldIds: string[];
  // Recent live messages kept verbatim in the payload.
  keepIds: string[];
  budgetTokens: number;
  // Estimated payload tokens after the planned compaction (or current tokens
  // when no compaction is needed).
  projectedTokens: number;
};

export function planCompaction({
  messages,
  systemTokens,
  existingSummaryTokens = 0,
  windowTokens,
  triggerRatio = COMPACTION_TRIGGER_RATIO,
  keepRecent = KEEP_RECENT_MESSAGES,
  minFold = MIN_MESSAGES_TO_COMPACT,
  projectedSummaryTokens = SUMMARY_MAX_OUTPUT_TOKENS,
}: {
  // Chronological live messages (those not already folded into a checkpoint).
  messages: CompactionCandidate[];
  systemTokens: number;
  existingSummaryTokens?: number;
  windowTokens: number;
  triggerRatio?: number;
  keepRecent?: number;
  minFold?: number;
  projectedSummaryTokens?: number;
}): CompactionPlan {
  const budgetTokens = Math.floor(windowTokens * triggerRatio);
  const liveTokens = messages.reduce((total, m) => total + m.tokens, 0);
  const currentTokens = systemTokens + existingSummaryTokens + liveTokens;

  const noop: CompactionPlan = {
    shouldCompact: false,
    foldIds: [],
    keepIds: messages.map((m) => m.id),
    budgetTokens,
    projectedTokens: currentTokens,
  };

  if (currentTokens <= budgetTokens) {
    return noop;
  }

  // Fold the oldest messages until the projected payload fits, but never drop
  // the most recent `keepRecent`. After compaction the prior summary is replaced
  // by one freshly-regenerated block, so we plan against a single summary cost.
  const maxFoldable = Math.max(0, messages.length - keepRecent);
  const projectedBase = systemTokens + projectedSummaryTokens;
  let fold = 0;
  let keptTokens = liveTokens;

  while (fold < maxFoldable && projectedBase + keptTokens > budgetTokens) {
    keptTokens -= messages[fold].tokens;
    fold += 1;
  }

  if (fold < minFold) {
    return noop;
  }

  return {
    shouldCompact: true,
    foldIds: messages.slice(0, fold).map((m) => m.id),
    keepIds: messages.slice(fold).map((m) => m.id),
    budgetTokens,
    projectedTokens: projectedBase + keptTokens,
  };
}

export function buildConversationSummaryBlock(
  summary: string | null | undefined
): string {
  const trimmed = summary?.trim();
  if (!trimmed) {
    return "";
  }

  return `<conversation_summary>
This summarizes earlier parts of the current conversation that were compacted to stay within the model's context window. Treat it as established, already-discussed context and continue seamlessly.

${trimmed}
</conversation_summary>`;
}
