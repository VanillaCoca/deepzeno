import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_RESEARCH_BUDGET,
  CHAT_RESEARCH_RUNS_PER_TURN,
  hasLiveRun,
  isResearchableKind,
  normalizeResearchQuestion,
  RESEARCH_QUESTION_MAX_LENGTH,
} from "@/lib/ai/tools/start-research-core";
import { BUDGET_BOUNDS } from "@/lib/research/run-progress-core";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

function isoSecondsAgo(seconds: number) {
  return new Date(NOW - seconds * 1000).toISOString();
}

describe("CHAT_RESEARCH_BUDGET", () => {
  it("is cheaper than the UI default the user is shown a cost for", () => {
    // The whole justification for firing without a confirmation card is that
    // the spend is small. If this ever creeps up to the UI default (6/10), the
    // "no card needed" argument goes with it.
    assert.ok(CHAT_RESEARCH_BUDGET.maxSearches < 6);
    assert.ok(CHAT_RESEARCH_BUDGET.maxFetches < 10);
  });

  it("survives the clamp the pipeline applies", () => {
    // A budget outside the bounds would be silently rewritten, so the number in
    // this module would stop being the number that runs.
    assert.ok(
      CHAT_RESEARCH_BUDGET.maxSearches >= BUDGET_BOUNDS.maxSearches.min
    );
    assert.ok(
      CHAT_RESEARCH_BUDGET.maxSearches <= BUDGET_BOUNDS.maxSearches.max
    );
    assert.ok(CHAT_RESEARCH_BUDGET.maxFetches >= BUDGET_BOUNDS.maxFetches.min);
    assert.ok(CHAT_RESEARCH_BUDGET.maxFetches <= BUDGET_BOUNDS.maxFetches.max);
  });

  it("allows exactly one run per turn", () => {
    assert.equal(CHAT_RESEARCH_RUNS_PER_TURN, 1);
  });
});

describe("normalizeResearchQuestion", () => {
  it("accepts a plain question and trims it", () => {
    const result = normalizeResearchQuestion("  Cursor 现在的定价是多少？  ");
    assert.deepEqual(result, {
      ok: true,
      question: "Cursor 现在的定价是多少？",
    });
  });

  it("salvages the prose from a question wrapped in marker syntax", () => {
    // The model was told the `[[ir:…]]` protocol two paragraphs before it was
    // told about this tool. Wrapping the argument in it is the single most
    // likely way to get an unreadable node title.
    const result = normalizeResearchQuestion(
      "[[ir:open_question|Cursor 现在的定价是多少|竞品对比需要最新价格]]"
    );
    assert.deepEqual(result, {
      ok: true,
      question: "Cursor 现在的定价是多少",
    });
  });

  it("refuses an unterminated marker rather than inventing a title", () => {
    // Iron Law 2: a refused tool call is a miss the model can report; a node
    // titled "[[ir:open_question|half" is an error nobody can read.
    const result = normalizeResearchQuestion("[[ir:open_question|half a que");
    assert.deepEqual(result, { ok: false, reason: "empty_question" });
  });

  it("refuses blank and absent input", () => {
    assert.deepEqual(normalizeResearchQuestion("   "), {
      ok: false,
      reason: "empty_question",
    });
    assert.deepEqual(normalizeResearchQuestion(null), {
      ok: false,
      reason: "empty_question",
    });
    assert.deepEqual(normalizeResearchQuestion(undefined), {
      ok: false,
      reason: "empty_question",
    });
  });

  it("refuses a question longer than a node title may be", () => {
    const tooLong = "价".repeat(RESEARCH_QUESTION_MAX_LENGTH + 1);
    assert.deepEqual(normalizeResearchQuestion(tooLong), {
      ok: false,
      reason: "question_too_long",
    });
    // The boundary itself is fine — the column holds exactly this much.
    const atLimit = "价".repeat(RESEARCH_QUESTION_MAX_LENGTH);
    assert.deepEqual(normalizeResearchQuestion(atLimit), {
      ok: true,
      question: atLimit,
    });
  });
});

describe("isResearchableKind", () => {
  it("matches the pipeline's own origin gate", () => {
    assert.equal(isResearchableKind("open_question"), true);
    assert.equal(isResearchableKind("hypothesis"), true);
    for (const kind of [
      "goal",
      "constraint",
      "plan",
      "principle",
      "rejection",
    ]) {
      assert.equal(isResearchableKind(kind), false);
    }
  });
});

describe("hasLiveRun", () => {
  it("reports no run when there is nothing to report", () => {
    assert.equal(hasLiveRun([], NOW), false);
  });

  it("treats a freshly checkpointed running run as busy", () => {
    assert.equal(
      hasLiveRun(
        [
          {
            status: "running",
            createdAt: isoSecondsAgo(600),
            progress: { at: isoSecondsAgo(10) },
          },
        ],
        NOW
      ),
      true
    );
  });

  it("frees the question once a run has lost contact", () => {
    // A killed invocation leaves the row at `running` forever. Trusting status
    // alone would lock this question out of research permanently — the worst
    // possible outcome for a guard whose only job is to avoid duplicate spend.
    assert.equal(
      hasLiveRun(
        [
          {
            status: "running",
            createdAt: isoSecondsAgo(900),
            progress: { at: isoSecondsAgo(400) },
          },
        ],
        NOW
      ),
      false
    );
  });

  it("falls back to creation time when no checkpoint landed yet", () => {
    // A run that has only just been inserted has no `progress.at`. It is busy,
    // not stale.
    assert.equal(
      hasLiveRun(
        [{ status: "running", createdAt: isoSecondsAgo(3), progress: null }],
        NOW
      ),
      true
    );
    assert.equal(
      hasLiveRun(
        [{ status: "running", createdAt: isoSecondsAgo(999), progress: null }],
        NOW
      ),
      false
    );
  });

  it("counts a cancelling run as still in flight", () => {
    // Cancellation lands at the next phase boundary, so the pipeline is still
    // spending until it gets there.
    assert.equal(
      hasLiveRun(
        [
          {
            status: "cancelling",
            createdAt: isoSecondsAgo(30),
            progress: { at: isoSecondsAgo(5) },
          },
        ],
        NOW
      ),
      true
    );
  });

  it("ignores every terminal status", () => {
    for (const status of ["done", "partial", "failed", "cancelled"]) {
      assert.equal(
        hasLiveRun(
          [
            {
              status,
              createdAt: isoSecondsAgo(20),
              progress: { at: isoSecondsAgo(1) },
            },
          ],
          NOW
        ),
        false
      );
    }
  });

  it("finds the live run behind a wall of finished ones", () => {
    assert.equal(
      hasLiveRun(
        [
          {
            status: "done",
            createdAt: isoSecondsAgo(50),
            progress: { at: isoSecondsAgo(45) },
          },
          {
            status: "failed",
            createdAt: isoSecondsAgo(400),
            progress: null,
          },
          {
            status: "running",
            createdAt: isoSecondsAgo(60),
            progress: { at: isoSecondsAgo(2) },
          },
        ],
        NOW
      ),
      true
    );
  });
});
