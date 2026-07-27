import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InboxItem } from "../../lib/ir/inbox-core.ts";
import type { IRNode } from "../../lib/ir/types.ts";
import {
  buildReEntryOverlay,
  type ChangedItem,
  decideReEntryMode,
  hasStructuralChange,
  RE_ENTRY_BLOCKED_TOP,
  RE_ENTRY_NARRATIVE_THRESHOLD_SECONDS,
  RE_ENTRY_OVERLAY_THRESHOLD_SECONDS,
  RE_ENTRY_SECTION_MAX_ITEMS,
  RE_ENTRY_SECTION_ORDER,
  rankChangedItems,
  type ReEntryOverlay,
  type ReEntrySection,
  type ReEntrySectionId,
  shouldAdvanceWatermark,
  type StructuralChangeSignals,
  type UnfinishedIntent,
} from "../../lib/workspace/re-entry-overlay-core.ts";

function expectSection<Id extends ReEntrySectionId>(
  overlay: ReEntryOverlay | null,
  id: Id
): Extract<ReEntrySection, { id: Id }> {
  const section = overlay?.sections.find((candidate) => candidate.id === id);

  if (!section) {
    assert.fail(`expected a "${id}" section`);
  }

  return section as Extract<ReEntrySection, { id: Id }>;
}

const QUIET: StructuralChangeSignals = {
  newActiveNodes: 0,
  supersedeEdgesWritten: 0,
  invalidatedAssumptions: 0,
  pendingNetIncrease: 0,
};

const HOUR = 60 * 60;

const intent: UnfinishedIntent = {
  text: "定价那条待决问题等调研 Agent 回来再拍",
  source: "user_note",
  sourceChatId: "chat-1",
};

const blockedItem = (id: string, blastRadius: number): InboxItem => ({
  node: { id, title: `候选 ${id}` } as IRNode,
  tier: 0,
  blastRadius,
  topDownstream: [],
  isSupersede: false,
  reshapeTargetId: null,
});

const changedItem = (
  id: string,
  kind: ChangedItem["kind"],
  at = "2026-07-20T00:00:00.000Z"
): ChangedItem => ({ id, kind, title: `变更 ${id}`, at });

const build = (overrides: Partial<Parameters<typeof buildReEntryOverlay>[0]>) =>
  buildReEntryOverlay({
    mode: "overlay",
    unfinishedIntent: null,
    blocked: [],
    changed: [],
    queueTotal: 0,
    ...overrides,
  });

describe("hasStructuralChange — §2.1, purely structural", () => {
  it("is false only when nothing moved", () => {
    assert.equal(hasStructuralChange(QUIET), false);
  });

  it("fires on any single signal", () => {
    for (const key of Object.keys(QUIET) as (keyof StructuralChangeSignals)[]) {
      assert.equal(hasStructuralChange({ ...QUIET, [key]: 1 }), true, key);
    }
  });
});

describe("decideReEntryMode — §2.1 trigger table", () => {
  const decide = (
    absenceSeconds: number | null,
    signals: StructuralChangeSignals | null = QUIET,
    dismissedInSession = false
  ) => decideReEntryMode({ absenceSeconds, signals, dismissedInSession });

  it("stays quiet for a short absence with nothing changed", () => {
    assert.equal(decide(2 * HOUR), "none");
  });

  it("shows up under 24h when structure actually moved", () => {
    assert.equal(decide(2 * HOUR, { ...QUIET, newActiveNodes: 1 }), "overlay");
  });

  it("shows up past 24h on absence alone", () => {
    assert.equal(decide(RE_ENTRY_OVERLAY_THRESHOLD_SECONDS), "overlay");
    assert.equal(decide(RE_ENTRY_OVERLAY_THRESHOLD_SECONDS - 1), "none");
  });

  it("adds the narrative variant at 14 days", () => {
    assert.equal(
      decide(RE_ENTRY_NARRATIVE_THRESHOLD_SECONDS),
      "overlay_with_narrative"
    );
    assert.equal(
      decide(RE_ENTRY_NARRATIVE_THRESHOLD_SECONDS - 1),
      "overlay"
    );
  });

  it("respects dismissal for the rest of the session, however long the absence", () => {
    assert.equal(
      decide(RE_ENTRY_NARRATIVE_THRESHOLD_SECONDS, QUIET, true),
      "none"
    );
  });

  it("stays quiet rather than guessing when inputs are missing", () => {
    assert.equal(decide(null), "none");
    assert.equal(decide(30 * HOUR, null), "none");
  });
});

describe("shouldAdvanceWatermark — §2.5", () => {
  it("does not advance on open: switching away mid-read must not eat the diff", () => {
    assert.equal(shouldAdvanceWatermark("panel_opened"), false);
  });

  it("advances once the diff was dismissed or read through", () => {
    assert.equal(shouldAdvanceWatermark("overlay_dismissed"), true);
    assert.equal(shouldAdvanceWatermark("overlay_read_through"), true);
  });
});

describe("rankChangedItems — consequence over recency", () => {
  it("puts an overturned truth above a brand-new one", () => {
    const ranked = rankChangedItems([
      changedItem("fresh", "new_truth", "2026-07-27T00:00:00.000Z"),
      changedItem("old", "superseded_truth", "2026-07-01T00:00:00.000Z"),
    ]);
    assert.deepEqual(
      ranked.map((item) => item.id),
      ["old", "fresh"]
    );
  });

  it("orders the five kinds by consequence", () => {
    const ranked = rankChangedItems([
      changedItem("e", "dismissed_candidate"),
      changedItem("d", "new_truth"),
      changedItem("c", "watchtower_alert"),
      changedItem("b", "invalidated_assumption"),
      changedItem("a", "superseded_truth"),
    ]);
    assert.deepEqual(
      ranked.map((item) => item.id),
      ["a", "b", "c", "d", "e"]
    );
  });

  it("breaks ties by recency, then by id, and never mutates the input", () => {
    const input = [
      changedItem("b", "new_truth", "2026-07-01T00:00:00.000Z"),
      changedItem("a", "new_truth", "2026-07-02T00:00:00.000Z"),
      changedItem("c", "new_truth", "2026-07-02T00:00:00.000Z"),
    ];
    const snapshot = input.map((item) => item.id);
    assert.deepEqual(
      rankChangedItems(input).map((item) => item.id),
      ["a", "c", "b"]
    );
    assert.deepEqual(
      input.map((item) => item.id),
      snapshot
    );
  });
});

describe("buildReEntryOverlay — §2.2 / §2.3", () => {
  it("returns nothing when the mode says nothing", () => {
    assert.equal(build({ mode: "none", unfinishedIntent: intent }), null);
  });

  it("returns nothing rather than an empty overlay", () => {
    assert.equal(build({}), null);
  });

  it("keeps the three sections in the fixed order — §4.2 forbids reordering", () => {
    const overlay = build({
      unfinishedIntent: intent,
      blocked: [blockedItem("b1", 3)],
      changed: [changedItem("c1", "new_truth")],
      queueTotal: 9,
    });
    assert.deepEqual(
      overlay?.sections.map((section) => section.id),
      [...RE_ENTRY_SECTION_ORDER]
    );
  });

  it("omits sections with no data, leaving the survivors in order", () => {
    const overlay = build({ changed: [changedItem("c1", "new_truth")] });
    assert.deepEqual(overlay?.sections.map((section) => section.id), [
      "changed",
    ]);
  });

  it("never invents an intent — the section is absent, not filled in", () => {
    const overlay = build({ blocked: [blockedItem("b1", 1)], queueTotal: 1 });
    assert.equal(
      overlay?.sections.some((section) => section.id === "unfinished_intent"),
      false
    );
  });

  it("names three blocked items and hands the rest to the queue", () => {
    const overlay = build({
      blocked: [
        blockedItem("b1", 9),
        blockedItem("b2", 5),
        blockedItem("b3", 3),
        blockedItem("b4", 1),
      ],
      queueTotal: 15,
    });
    const section = expectSection(overlay, "blocked");
    assert.equal(section.items.length, RE_ENTRY_BLOCKED_TOP);
    assert.equal(section.hiddenCount, 1);
    assert.equal(section.queueTotal, 15);
  });

  it("preserves the inbox's own ranking instead of re-sorting it", () => {
    const overlay = build({
      blocked: [blockedItem("b1", 1), blockedItem("b2", 99)],
      queueTotal: 2,
    });
    const section = expectSection(overlay, "blocked");
    assert.deepEqual(
      section.items.map((item) => item.node.id),
      ["b1", "b2"]
    );
  });

  it("truncates changes loudly — the remainder count is always reported", () => {
    const overlay = build({
      changed: Array.from({ length: 8 }, (_, i) =>
        changedItem(`c${i}`, "new_truth")
      ),
    });
    const section = expectSection(overlay, "changed");
    assert.equal(section.items.length, RE_ENTRY_SECTION_MAX_ITEMS);
    assert.equal(section.hiddenCount, 3);
  });

  it("truncates by consequence, so what is dropped is what matters least", () => {
    const overlay = build({
      changed: [
        ...Array.from({ length: 5 }, (_, i) =>
          changedItem(`minor${i}`, "dismissed_candidate")
        ),
        changedItem("critical", "superseded_truth"),
      ],
    });
    const section = expectSection(overlay, "changed");
    assert.equal(section.items[0].id, "critical");
    assert.equal(section.hiddenCount, 1);
  });

  it("requests narrative prose only past the 14-day threshold", () => {
    assert.equal(
      build({ changed: [changedItem("c1", "new_truth")] })?.narrativeRequested,
      false
    );
    assert.equal(
      build({
        mode: "overlay_with_narrative",
        changed: [changedItem("c1", "new_truth")],
      })?.narrativeRequested,
      true
    );
  });
});
