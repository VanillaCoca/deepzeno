import "server-only";

import { listPendingInboxForUser } from "@/lib/ir/inbox-queries";
import { IRNotReadyError } from "@/lib/ir/queries";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildReEntryOverlay,
  type ChangedItem,
  decideReEntryMode,
  type ReEntryOverlay,
  type StructuralChangeSignals,
} from "@/lib/workspace/re-entry-overlay-core";

/**
 * Server assembly for the re-entry overlay — 修订案 №4 §2.
 *
 * Ranking, truncation, section order and the trigger table all live in
 * `re-entry-overlay-core.ts` (pure, unit-tested). This file only fetches. The
 * split is deliberate: every rule that could be got subtly wrong is testable
 * without a database, and this module stays boring enough to read in one pass.
 *
 * Watermark: `project_user_view_state.last_seen_at`, the same row the change
 * bar has always used. Amendment №4 §2.5 flagged this as "疑似缺失，需新增,
 * 最高优先级" — that was wrong, the table has existed since migration
 * 20260506000002 and `markProjectSeenForUser` already maintains it. No new data
 * layer work is required for the overlay.
 */

// V1 fetch ceiling per changed-kind. Past this the remainder count under-
// reports; 50 changes in one absence is already past the point where a list is
// the right medium (that is what §2.4's narrative variant is for).
const CHANGED_FETCH_LIMIT = 50;

/**
 * Section 1 (未竟意图) is OUT for V1 — product decision 2026-07-27, closing
 * 附 D item 2. The sandbox does not persist a "what I meant to do next" note,
 * and §2.3 forbids the model inventing one. So the section is simply absent
 * rather than filled with a guess: a wrong "you were about to…" would cost
 * more trust than the empty space costs convenience.
 *
 * When that note starts being captured, pass it here and the section appears
 * in its (already fixed) first position — no other change needed.
 */
const UNFINISHED_INTENT_V1 = null;

type DatabaseRecord = Record<string, unknown>;

function getClient(): any {
  return getSupabaseAdminClient() as any;
}

async function listRows(
  promise: PromiseLike<{ data: DatabaseRecord[] | null; error: unknown }>
) {
  const { data, error } = await promise;

  // A missing table (pre-migration) or a failed leg degrades to "nothing to
  // report" rather than taking the whole panel down. Iron Law 2: a re-entry
  // screen that under-reports is recoverable; one that 500s is not.
  if (error) {
    console.error("Re-entry overlay query failed", error);
    return [];
  }

  return data ?? [];
}

function toChangedItems(
  rows: DatabaseRecord[],
  kind: ChangedItem["kind"],
  timeKey: string
): ChangedItem[] {
  const items: ChangedItem[] = [];

  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : null;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const at = typeof row[timeKey] === "string" ? (row[timeKey] as string) : null;

    // An untitled or untimed row cannot be rendered honestly — it would show
    // as a blank line, which reads as a bug rather than as information.
    if (!(id && title && at)) {
      continue;
    }

    items.push({ id, kind, title, at });
  }

  return items;
}

/**
 * Watchtower alerts since the watermark. The alert timestamp lives on the
 * watch (`ir_watches.last_alert_at`), the readable title on the node, so this
 * is two hops rather than one.
 */
async function listWatchtowerAlerts(projectId: string, since: string) {
  const watches = await listRows(
    getClient()
      .from("ir_watches")
      .select("node_id, last_alert_at")
      .eq("project_id", projectId)
      .gt("last_alert_at", since)
      .order("last_alert_at", { ascending: false })
      .limit(CHANGED_FETCH_LIMIT)
  );

  if (watches.length === 0) {
    return [];
  }

  const alertedAtByNode = new Map<string, string>();
  for (const watch of watches) {
    const nodeId = typeof watch.node_id === "string" ? watch.node_id : null;
    const at =
      typeof watch.last_alert_at === "string" ? watch.last_alert_at : null;

    if (nodeId && at) {
      alertedAtByNode.set(nodeId, at);
    }
  }

  const nodes = await listRows(
    getClient()
      .from("ir_nodes")
      .select("id, title")
      .eq("project_id", projectId)
      .in("id", [...alertedAtByNode.keys()])
  );

  return toChangedItems(
    nodes.map((node) => ({
      ...node,
      alerted_at: alertedAtByNode.get(String(node.id)) ?? null,
    })),
    "watchtower_alert",
    "alerted_at"
  );
}

export type ReEntryOverlayPayload = {
  overlay: ReEntryOverlay | null;
  /**
   * Change kinds §2.2 names that this build cannot yet source, with the reason.
   * Surfaced rather than silently skipped: §2.3 bans quiet omission, and that
   * rule has to bind the server too — a section that is short because the data
   * is missing looks exactly like a section that is short because nothing
   * happened.
   */
  uncoveredKinds: { kind: string; reason: string }[];
};

/**
 * `dismissed_candidate` and `invalidated_assumption` are specified in §2.2 but
 * not yet computable: `ir_nodes` records `confirmed_at` and `superseded_at` but
 * has no `dismissed_at`, and assumption invalidation (v1 §6.4) leaves no
 * timestamped trace. Both need one small migration each before they can appear.
 */
const UNCOVERED_KINDS = [
  {
    kind: "dismissed_candidate",
    reason: "ir_nodes has no dismissed_at column",
  },
  {
    kind: "invalidated_assumption",
    reason: "assumption invalidation is not timestamped",
  },
];

export async function getProjectReEntryOverlay({
  userId,
  projectId,
  absenceSeconds,
  lastSeenAt,
  dismissedInSession = false,
}: {
  userId: string;
  projectId: string;
  /** From the same snapshot call — the caller has already read the watermark. */
  absenceSeconds: number | null;
  lastSeenAt: string | null;
  dismissedInSession?: boolean;
}): Promise<ReEntryOverlayPayload> {
  if (!lastSeenAt) {
    // First-ever visit to this project: there is no "since", so there is
    // nothing honest to put in the overlay.
    return { overlay: null, uncoveredKinds: UNCOVERED_KINDS };
  }

  let blocked: Awaited<ReturnType<typeof listPendingInboxForUser>>["items"] = [];

  try {
    const inbox = await listPendingInboxForUser({ userId, projectId });
    blocked = inbox.items;
  } catch (error) {
    if (!(error instanceof IRNotReadyError)) {
      throw error;
    }
  }

  const [newTruthRows, supersededRows, watchtowerAlerts] = await Promise.all([
    listRows(
      getClient()
        .from("ir_nodes")
        .select("id, title, confirmed_at")
        .eq("project_id", projectId)
        .eq("status", "active")
        .gt("confirmed_at", lastSeenAt)
        .order("confirmed_at", { ascending: false })
        .limit(CHANGED_FETCH_LIMIT)
    ),
    listRows(
      getClient()
        .from("ir_nodes")
        .select("id, title, superseded_at")
        .eq("project_id", projectId)
        .eq("status", "superseded")
        .gt("superseded_at", lastSeenAt)
        .order("superseded_at", { ascending: false })
        .limit(CHANGED_FETCH_LIMIT)
    ),
    listWatchtowerAlerts(projectId, lastSeenAt),
  ]);

  const changed: ChangedItem[] = [
    ...toChangedItems(supersededRows, "superseded_truth", "superseded_at"),
    ...toChangedItems(newTruthRows, "new_truth", "confirmed_at"),
    ...watchtowerAlerts,
  ];

  // Structural change (§2.1) is what lets the overlay appear inside the 24h
  // window. Derived from what we already fetched — presence is all the trigger
  // needs, so no extra count queries. Kept purely structural on purpose: the
  // trigger must stay deterministic and free of model judgment.
  const signals: StructuralChangeSignals = {
    newActiveNodes: newTruthRows.length,
    supersedeEdgesWritten: supersededRows.length,
    // Not detectable yet — see UNCOVERED_KINDS. Reported as 0 rather than
    // guessed, which can only make the overlay appear less often, never more.
    invalidatedAssumptions: 0,
    pendingNetIncrease: blocked.filter(
      (item) => item.node.createdAt > lastSeenAt
    ).length,
  };

  const mode = decideReEntryMode({
    absenceSeconds,
    signals,
    dismissedInSession,
  });

  return {
    overlay: buildReEntryOverlay({
      mode,
      unfinishedIntent: UNFINISHED_INTENT_V1,
      blocked,
      changed,
      queueTotal: blocked.length,
    }),
    uncoveredKinds: UNCOVERED_KINDS,
  };
}
