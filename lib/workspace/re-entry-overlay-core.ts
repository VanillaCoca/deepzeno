import type { InboxItem } from "@/lib/ir/inbox-core";

/**
 * Pure model for the re-entry overlay — 修订案 №4 §2.
 *
 * Relationship to `re-entry-core.ts`: that module ranks the "since last visit"
 * change bar, which is §2.2's THIRD section only. This module is the whole
 * overlay — the two sections in front of it are what task-resumption research
 * says people actually reach for first, and they did not exist. №1 §6's global
 * pending bar remains the resting state; the overlay floats above it and
 * collapses back into it on close.
 *
 * Why an overlay and not a taller header (§2.1): a variable-height bar pushes
 * every node down by a different amount on every visit, which is precisely the
 * spatial-memory damage v1 §1.1 forbids and the single most-documented failure
 * of adaptive UI. Canvas geometry impact must be exactly zero.
 *
 * Why exactly three sections in exactly this order (§2.2): people resuming a
 * dormant task reach first for their own forward-looking note ("what I meant to
 * do next"), then for what is blocking them, then for what changed — and only
 * ~10% of resumed sessions produce a real action inside the first minute, with
 * seven locations visited on average before the first edit. The overlay exists
 * to collapse those seven visits. It is not a project summary.
 *
 * No `server-only`, no DB access — total functions, exercised by
 * tests/unit/re-entry-overlay-core.test.ts.
 */

export const RE_ENTRY_OVERLAY_THRESHOLD_SECONDS = 24 * 60 * 60;
export const RE_ENTRY_NARRATIVE_THRESHOLD_SECONDS = 14 * 24 * 60 * 60;

/** §2.3: past this many rows a section truncates — and says so, out loud. */
export const RE_ENTRY_SECTION_MAX_ITEMS = 5;

/** §2.2: the blocked section names three and points at the queue for the rest. */
export const RE_ENTRY_BLOCKED_TOP = 3;

export type ReEntryMode = "none" | "overlay" | "overlay_with_narrative";

/**
 * Fixed. §4.2 lists section composition and section order among the things the
 * agent may never vary; only the items *inside* a section are its to choose.
 */
export const RE_ENTRY_SECTION_ORDER = [
  "unfinished_intent",
  "blocked",
  "changed",
] as const;

export type ReEntrySectionId = (typeof RE_ENTRY_SECTION_ORDER)[number];

/**
 * §2.1 structural change — purely structural, so the trigger stays
 * deterministic and costs no tokens. Distinct from §3.2's "load-bearing",
 * which has a semantic component and therefore never participates in
 * triggering.
 */
export type StructuralChangeSignals = {
  newActiveNodes: number;
  supersedeEdgesWritten: number;
  invalidatedAssumptions: number;
  pendingNetIncrease: number;
};

export function hasStructuralChange(signals: StructuralChangeSignals): boolean {
  return (
    signals.newActiveNodes > 0 ||
    signals.supersedeEdgesWritten > 0 ||
    signals.invalidatedAssumptions > 0 ||
    signals.pendingNetIncrease > 0
  );
}

/**
 * §2.1 trigger table. Deterministic — no model call. Absence alone is enough
 * past 24h; below that, structure must actually have moved, otherwise coming
 * back from lunch would produce a "welcome back" for nothing.
 */
export function decideReEntryMode({
  absenceSeconds,
  signals,
  dismissedInSession,
}: {
  absenceSeconds: number | null;
  signals: StructuralChangeSignals | null;
  dismissedInSession: boolean;
}): ReEntryMode {
  if (dismissedInSession || absenceSeconds === null || signals === null) {
    return "none";
  }

  if (absenceSeconds >= RE_ENTRY_NARRATIVE_THRESHOLD_SECONDS) {
    return "overlay_with_narrative";
  }

  if (absenceSeconds >= RE_ENTRY_OVERLAY_THRESHOLD_SECONDS) {
    return "overlay";
  }

  return hasStructuralChange(signals) ? "overlay" : "none";
}

/**
 * §2.5. The watermark advances when the diff has been *read*, not when the
 * panel opened — advancing on open means switching away mid-read silently
 * destroys the unread remainder, and the user has no way to get it back.
 */
export type WatermarkTrigger =
  | "panel_opened"
  | "overlay_dismissed"
  | "overlay_read_through";

export function shouldAdvanceWatermark(trigger: WatermarkTrigger): boolean {
  return trigger !== "panel_opened";
}

export const CHANGED_KINDS = [
  "superseded_truth",
  "invalidated_assumption",
  "watchtower_alert",
  "new_truth",
  "dismissed_candidate",
] as const;

export type ChangedKind = (typeof CHANGED_KINDS)[number];

/**
 * Ordered by what it costs the user NOT to know — mirroring inbox K2 and
 * re-entry-core: consequence, never recency and never confidence. A truth that
 * stopped being true outranks a plan proposed a minute ago, always.
 *
 * `superseded_truth` and `invalidated_assumption` lead because they are the
 * only entries that can invalidate reasoning the user already built on, and
 * nothing else in the product will raise them again — they are already
 * applied, so they never land in an inbox.
 */
const CHANGED_CONSEQUENCE: Record<ChangedKind, number> = {
  superseded_truth: 5,
  invalidated_assumption: 4,
  watchtower_alert: 3,
  new_truth: 2,
  dismissed_candidate: 1,
};

export type ChangedItem = {
  id: string;
  kind: ChangedKind;
  title: string;
  /** ISO timestamp — tiebreaker only; it never lifts an item across kinds. */
  at: string;
};

export type UnfinishedIntent = {
  /** Verbatim from the user's own note or the last unfinished sandbox action. */
  text: string;
  source: "user_note" | "sandbox_open_action";
  sourceChatId: string | null;
};

/**
 * Every section carries `hiddenCount` in the type itself, so a renderer cannot
 * drop rows without having been handed the number it must display. §2.3 bans
 * silent truncation (mirroring Watchtower N3): a list that quietly stops at
 * five reads as "that was everything".
 */
export type ReEntrySection =
  | {
      id: "unfinished_intent";
      intent: UnfinishedIntent;
    }
  | {
      id: "blocked";
      items: InboxItem[];
      hiddenCount: number;
      /** Total pending in the project — the "see all (N)" affordance. */
      queueTotal: number;
    }
  | {
      id: "changed";
      items: ChangedItem[];
      hiddenCount: number;
    };

export type ReEntryOverlay = {
  mode: Exclude<ReEntryMode, "none">;
  /** Always a subsequence of RE_ENTRY_SECTION_ORDER. Never reordered. */
  sections: ReEntrySection[];
  /** §2.4 — the one place a model may write free prose, and only past 14d. */
  narrativeRequested: boolean;
};

export function rankChangedItems(items: ChangedItem[]): ChangedItem[] {
  return [...items].sort((left, right) => {
    const consequenceDelta =
      CHANGED_CONSEQUENCE[right.kind] - CHANGED_CONSEQUENCE[left.kind];

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

function truncate<T>(items: T[], limit: number) {
  return {
    shown: items.slice(0, limit),
    hiddenCount: Math.max(0, items.length - limit),
  };
}

/**
 * Assemble the overlay. Sections with nothing to say are omitted rather than
 * rendered empty — and section 1 in particular is omitted, never filled by
 * inference: 宁漏勿错. A guessed "you were probably about to…" is the one
 * sentence in this product that would cost the most trust to get wrong.
 *
 * Returns null when nothing survives, so the caller never renders an overlay
 * that says nothing. `blocked` is capped at three by design — the Judgment
 * Inbox owns the queue, and a second full queue here would split the user's
 * attention between two places that must never disagree.
 */
export function buildReEntryOverlay({
  mode,
  unfinishedIntent,
  blocked,
  changed,
  queueTotal,
}: {
  mode: ReEntryMode;
  unfinishedIntent: UnfinishedIntent | null;
  /** Pre-ranked by inbox-core (tier, then blast radius). Order is preserved. */
  blocked: InboxItem[];
  changed: ChangedItem[];
  queueTotal: number;
}): ReEntryOverlay | null {
  if (mode === "none") {
    return null;
  }

  const sections: ReEntrySection[] = [];

  for (const id of RE_ENTRY_SECTION_ORDER) {
    if (id === "unfinished_intent") {
      if (unfinishedIntent) {
        sections.push({ id, intent: unfinishedIntent });
      }
      continue;
    }

    if (id === "blocked") {
      if (blocked.length > 0) {
        const { shown, hiddenCount } = truncate(blocked, RE_ENTRY_BLOCKED_TOP);
        sections.push({ id, items: shown, hiddenCount, queueTotal });
      }
      continue;
    }

    if (changed.length > 0) {
      const { shown, hiddenCount } = truncate(
        rankChangedItems(changed),
        RE_ENTRY_SECTION_MAX_ITEMS
      );
      sections.push({ id, items: shown, hiddenCount });
    }
  }

  if (sections.length === 0) {
    return null;
  }

  return {
    mode,
    sections,
    narrativeRequested: mode === "overlay_with_narrative",
  };
}
