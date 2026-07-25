// Pure consequence ranking for the "since last visit" change bar. Kept free of
// server-only imports so it can be unit-tested directly (same split as
// patrol-core.ts / inbox-core.ts / truth-budget.ts).

export const RE_ENTRY_CATEGORIES = [
  "superseded_truth",
  "mcp_writes",
  "new_candidates",
  "unresolved_open_questions",
] as const;

export type ReEntryCategory = (typeof RE_ENTRY_CATEGORIES)[number];

export type ReEntryCounts = Record<ReEntryCategory, number>;

export type ReEntryItem = {
  category: ReEntryCategory;
  id: string;
  title: string;
  /** ISO timestamp of the event that put this item in the change set. */
  at: string;
};

// Ordered by what it costs the user NOT to know, which is not the same as
// volume:
//   superseded_truth — something they had already confirmed stopped being
//     true. The only category that can invalidate decisions already built on
//     top of it, and the only one nothing else in the product will remind them
//     about again: it is already applied, so it never lands in an inbox.
//   mcp_writes — an external agent wrote into the project while they were
//     away. Iron Law 4 keeps those writes candidate-first, so nothing unsafe
//     happened, but unexpected agency is still something they must be able to
//     see.
//   new_candidates — waiting on their judgment. Routine, and the Judgment
//     Inbox already carries this load with its own count.
//   unresolved_open_questions — ZENO recording that it does not know
//     something. A note to self, not a demand on the user.
const CATEGORY_CONSEQUENCE: Record<ReEntryCategory, number> = {
  superseded_truth: 4,
  mcp_writes: 3,
  new_candidates: 2,
  unresolved_open_questions: 1,
};

export const RE_ENTRY_LIGHT_THRESHOLD_SECONDS = 30 * 60;
export const RE_ENTRY_FULL_THRESHOLD_SECONDS = 24 * 60 * 60;

/**
 * Total number of distinct things that changed.
 *
 * `mcp_writes` is deliberately excluded from the sum. Every MCP write inserts
 * a candidate row AND a decision_log row (see createMcpCandidate /
 * submitMcpFinding in lib/mcp/service.ts), so it is already counted inside
 * `new_candidates`; adding it again reported one agent write as two updates.
 * It is surfaced as an attribution of the candidate count, never as a sibling
 * of it. If some future MCP path writes something that is not a candidate the
 * total under-reports rather than inflates — per Iron Law 2, prefer to miss
 * than to make up.
 */
export function countReEntryUpdates(counts: ReEntryCounts) {
  return (
    counts.superseded_truth +
    counts.new_candidates +
    counts.unresolved_open_questions
  );
}

/**
 * The subset that is waiting on a human act. Superseded truth is excluded on
 * purpose: it has already been applied, so it is something to be told, not
 * something to be reviewed. That is exactly why the bar leads with it.
 */
export function countReEntryNeedsReview(counts: ReEntryCounts) {
  return counts.new_candidates + counts.unresolved_open_questions;
}

export function shouldShowReEntry({
  absenceSeconds,
  counts,
  dismissed,
}: {
  absenceSeconds: number | null;
  counts: ReEntryCounts | null;
  dismissed: boolean;
}) {
  if (dismissed || absenceSeconds === null || !counts) {
    return false;
  }

  return (
    absenceSeconds >= RE_ENTRY_LIGHT_THRESHOLD_SECONDS &&
    countReEntryUpdates(counts) > 0
  );
}

/**
 * Highest consequence first, then most recent inside a category. Recency never
 * lifts an item across a category boundary: a plan proposed a minute ago does
 * not outrank a truth that was overturned yesterday.
 */
export function rankReEntryItems(items: ReEntryItem[]): ReEntryItem[] {
  return [...items].sort((left, right) => {
    const consequenceDelta =
      CATEGORY_CONSEQUENCE[right.category] - CATEGORY_CONSEQUENCE[left.category];

    if (consequenceDelta !== 0) {
      return consequenceDelta;
    }

    const timeDelta = Date.parse(right.at) - Date.parse(left.at);

    if (timeDelta !== 0 && Number.isFinite(timeDelta)) {
      return timeDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

/**
 * Category rows for the expanded card, ordered by consequence and with the
 * empty ones dropped. `attribution` carries the MCP share of the candidate row
 * rather than letting it stand as a row of its own.
 */
export function summarizeReEntry(counts: ReEntryCounts) {
  const rows: {
    category: ReEntryCategory;
    count: number;
    attribution: number;
  }[] = [];

  for (const category of RE_ENTRY_CATEGORIES) {
    if (category === "mcp_writes") {
      continue;
    }

    const count = counts[category];

    if (count <= 0) {
      continue;
    }

    rows.push({
      category,
      count,
      attribution:
        category === "new_candidates"
          ? Math.min(counts.mcp_writes, count)
          : 0,
    });
  }

  return rows.sort(
    (left, right) =>
      CATEGORY_CONSEQUENCE[right.category] - CATEGORY_CONSEQUENCE[left.category]
  );
}

/**
 * What the one-line bar says. A bare count ("6 updates") does not tell the user
 * whether to care, so the bar leads with the single most consequential thing
 * that happened and reports the rest as a remainder.
 *
 * `item` is null when the server returned counts but no titles — the caller
 * then falls back to the category label alone, which is still ordered by
 * consequence.
 */
export function selectReEntryHeadline({
  counts,
  items,
}: {
  counts: ReEntryCounts;
  items: ReEntryItem[];
}): {
  category: ReEntryCategory | null;
  item: ReEntryItem | null;
  othersCount: number;
} {
  const total = countReEntryUpdates(counts);

  if (total <= 0) {
    return { category: null, item: null, othersCount: 0 };
  }

  const ranked = rankReEntryItems(items);
  const headline = ranked.at(0) ?? null;

  if (headline) {
    return {
      category: headline.category,
      item: headline,
      othersCount: Math.max(0, total - 1),
    };
  }

  let topCategory: ReEntryCategory | null = null;

  for (const category of RE_ENTRY_CATEGORIES) {
    if (category === "mcp_writes" || counts[category] <= 0) {
      continue;
    }

    if (
      topCategory === null ||
      CATEGORY_CONSEQUENCE[category] > CATEGORY_CONSEQUENCE[topCategory]
    ) {
      topCategory = category;
    }
  }

  return {
    category: topCategory,
    item: null,
    othersCount: Math.max(0, total - 1),
  };
}
