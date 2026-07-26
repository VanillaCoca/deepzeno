import "server-only";

// Zeno-initiated watches (Iron Law 0 — proactive diligence): after research
// lands evidence or the sweep extracts an externally-grounded assumption,
// suggest-and-create a patrol watch automatically. Patrol is automatic and
// cheap; only alerts are rationed (constitution §2a). Idempotent per node
// (unique node_id), best-effort everywhere — a failed suggestion must never
// break its caller.

import { logIREvent } from "@/lib/ir/queries";
import type { IRKind } from "@/lib/ir/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isWatchWorthy } from "./patrol-core";
import { admitNewWatch } from "./watch-admission";
import {
  createWatch,
  findWatchByNodeId,
  getProjectAgentSettings,
  getProjectOwnerId,
} from "./watch-queries";

type SuggestibleNode = {
  id: string;
  projectId: string;
  kind: IRKind;
  title: string;
};

// biome-ignore lint/suspicious/noExplicitAny: untyped admin client, matching lib/research/queries.ts.
function getClient(): any {
  return getSupabaseAdminClient() as any;
}

async function hasEvidence(nodeId: string): Promise<boolean> {
  const { count, error } = await getClient()
    .from("evidence")
    .select("id", { count: "exact", head: true })
    .eq("node_id", nodeId);
  return !error && (count ?? 0) > 0;
}

async function dependentCount(nodeId: string): Promise<number> {
  // Children in graph terms: edges whose flow direction makes this node the
  // premise. depends_on/refines/resolves point child → parent (to_node), so
  // dependents sit on from_node; implies points parent → child.
  const db = getClient();
  const [into, outOf] = await Promise.all([
    db
      .from("ir_edges")
      .select("id", { count: "exact", head: true })
      .eq("to_node", nodeId)
      .in("relation", ["depends_on", "refines", "resolves"]),
    db
      .from("ir_edges")
      .select("id", { count: "exact", head: true })
      .eq("from_node", nodeId)
      .eq("relation", "implies"),
  ]);
  return (into.count ?? 0) + (outOf.count ?? 0);
}

// Evaluate one node and create a suggested watch when it qualifies.
// Returns true when a watch exists after the call (new or pre-existing).
export async function suggestWatchForNode(
  node: SuggestibleNode
): Promise<boolean> {
  try {
    const existing = await findWatchByNodeId(node.id);
    if (existing) {
      return true;
    }

    const [evidenceBacked, dependents, settings] = await Promise.all([
      hasEvidence(node.id),
      dependentCount(node.id),
      getProjectAgentSettings(node.projectId).catch(() => null),
    ]);

    if (settings && !settings.patrolEnabled) {
      return false;
    }
    if (
      !isWatchWorthy({
        kind: node.kind,
        hasEvidence: evidenceBacked,
        dependentCount: dependents,
      })
    ) {
      return false;
    }

    const reasonParts: string[] = [];
    if (node.kind === "hypothesis") {
      reasonParts.push("可证伪假设");
    }
    if (dependents > 0) {
      reasonParts.push(`${dependents} 个判断建立在它之上`);
    }
    if (evidenceBacked) {
      reasonParts.push("已有网络证据需要保鲜");
    }

    // Quota check goes last, after the node has already proven itself worth
    // watching. Checking it first would be cheaper and wrong: it would spend
    // the user's slot budget on the question "is anyone over quota" rather
    // than "was this node worth a slot", and the event below would fire for
    // every unremarkable node the sweep walks past.
    const ownerId = await getProjectOwnerId(node.projectId);
    if (!ownerId) {
      return false;
    }
    const admission = await admitNewWatch(ownerId);
    if (!admission.admitted) {
      // Iron Law 2. Nobody is present to be told no, so the refusal is
      // written down instead — otherwise a node Zeno judged worth watching and
      // a node it dismissed leave exactly the same trace, and the standing
      // quota becomes invisible at the only moment it changed an outcome.
      // The user-facing half of this is the counter on the watch panel, which
      // explains every past and future refusal at once.
      await logIREvent({
        projectId: node.projectId,
        nodeId: node.id,
        event: "watch_quota_exceeded",
        layer: "watchtower",
        metadata: {
          activeWatches: admission.activeWatches,
          quota: admission.quota,
          reason: admission.reason,
        },
      });
      return false;
    }

    await createWatch({
      projectId: node.projectId,
      nodeId: node.id,
      origin: "zeno_suggested",
      reason: reasonParts.join(" · ") || "外部条件可能变化",
      cadence: settings?.defaultCadence ?? "daily",
    });
    return true;
  } catch (error) {
    // Best-effort by contract.
    console.warn("watch suggestion skipped", {
      nodeId: node.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
