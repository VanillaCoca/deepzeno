import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countReEntryNeedsReview,
  countReEntryUpdates,
  rankReEntryItems,
  type ReEntryCounts,
  type ReEntryItem,
  selectReEntryHeadline,
  shouldShowReEntry,
  summarizeReEntry,
} from "../../lib/workspace/re-entry-core.ts";

function counts(overrides: Partial<ReEntryCounts> = {}) {
  return {
    superseded_truth: 0,
    mcp_writes: 0,
    new_candidates: 0,
    unresolved_open_questions: 0,
    ...overrides,
  } satisfies ReEntryCounts;
}

function item(
  category: ReEntryItem["category"],
  id: string,
  at: string,
  title = id
) {
  return { category, id, title, at } satisfies ReEntryItem;
}

describe("countReEntryUpdates", () => {
  it("does not count an MCP write twice", () => {
    // Three agent writes landed as three candidates. That is three updates,
    // not six.
    const snapshot = counts({ new_candidates: 3, mcp_writes: 3 });

    assert.equal(countReEntryUpdates(snapshot), 3);
  });

  it("sums the categories that are genuinely distinct", () => {
    const snapshot = counts({
      superseded_truth: 1,
      new_candidates: 2,
      unresolved_open_questions: 4,
      mcp_writes: 2,
    });

    assert.equal(countReEntryUpdates(snapshot), 7);
  });

  it("excludes superseded truth from the needs-review count", () => {
    const snapshot = counts({
      superseded_truth: 5,
      new_candidates: 1,
      unresolved_open_questions: 1,
    });

    assert.equal(countReEntryNeedsReview(snapshot), 2);
  });
});

describe("shouldShowReEntry", () => {
  it("stays hidden for a short absence", () => {
    assert.equal(
      shouldShowReEntry({
        absenceSeconds: 60,
        counts: counts({ superseded_truth: 3 }),
        dismissed: false,
      }),
      false
    );
  });

  it("stays hidden when the only count is an MCP attribution", () => {
    // mcp_writes without candidates would mean the total is zero; showing a bar
    // that resolves to "0 updates" is the alert-fatigue failure mode.
    assert.equal(
      shouldShowReEntry({
        absenceSeconds: 86_400,
        counts: counts({ mcp_writes: 2 }),
        dismissed: false,
      }),
      false
    );
  });

  it("shows after a long absence with real updates", () => {
    assert.equal(
      shouldShowReEntry({
        absenceSeconds: 86_400,
        counts: counts({ superseded_truth: 1 }),
        dismissed: false,
      }),
      true
    );
  });
});

describe("rankReEntryItems", () => {
  it("puts an overturned truth above a newer candidate", () => {
    const ranked = rankReEntryItems([
      item("new_candidates", "fresh", "2026-07-24T10:00:00.000Z"),
      item("superseded_truth", "stale", "2026-07-20T10:00:00.000Z"),
    ]);

    assert.equal(ranked[0]?.id, "stale");
  });

  it("orders by recency inside a category", () => {
    const ranked = rankReEntryItems([
      item("new_candidates", "older", "2026-07-20T10:00:00.000Z"),
      item("new_candidates", "newer", "2026-07-24T10:00:00.000Z"),
    ]);

    assert.equal(ranked[0]?.id, "newer");
  });

  it("ranks an agent write above an ordinary candidate", () => {
    const ranked = rankReEntryItems([
      item("new_candidates", "mine", "2026-07-24T12:00:00.000Z"),
      item("mcp_writes", "agent", "2026-07-24T09:00:00.000Z"),
    ]);

    assert.equal(ranked[0]?.id, "agent");
  });

  it("does not mutate the input", () => {
    const input = [
      item("new_candidates", "a", "2026-07-24T10:00:00.000Z"),
      item("superseded_truth", "b", "2026-07-20T10:00:00.000Z"),
    ];
    rankReEntryItems(input);

    assert.equal(input[0]?.id, "a");
  });
});

describe("summarizeReEntry", () => {
  it("drops empty categories and never gives MCP writes a row", () => {
    const rows = summarizeReEntry(
      counts({ new_candidates: 4, mcp_writes: 2, superseded_truth: 1 })
    );

    assert.deepEqual(
      rows.map((row) => row.category),
      ["superseded_truth", "new_candidates"]
    );
    assert.equal(rows[1]?.attribution, 2);
  });

  it("never claims more agent writes than there are candidates", () => {
    const rows = summarizeReEntry(counts({ new_candidates: 1, mcp_writes: 9 }));

    assert.equal(rows[0]?.attribution, 1);
  });
});

describe("selectReEntryHeadline", () => {
  it("leads with the most consequential item and counts the remainder", () => {
    const result = selectReEntryHeadline({
      counts: counts({ superseded_truth: 1, new_candidates: 3 }),
      items: [
        item("new_candidates", "c1", "2026-07-24T10:00:00.000Z"),
        item(
          "superseded_truth",
          "t1",
          "2026-07-21T10:00:00.000Z",
          "domestic launch first"
        ),
      ],
    });

    assert.equal(result.item?.title, "domestic launch first");
    assert.equal(result.othersCount, 3);
  });

  it("falls back to the category when no titles came back", () => {
    const result = selectReEntryHeadline({
      counts: counts({ new_candidates: 2, unresolved_open_questions: 1 }),
      items: [],
    });

    assert.equal(result.item, null);
    assert.equal(result.category, "new_candidates");
    assert.equal(result.othersCount, 2);
  });

  it("reports nothing when nothing changed", () => {
    const result = selectReEntryHeadline({
      counts: counts({ mcp_writes: 3 }),
      items: [],
    });

    assert.equal(result.category, null);
    assert.equal(result.othersCount, 0);
  });
});
