import type { IREdge, IRKind, IRNode, IRRelation } from "@/lib/ir/types";

/**
 * Pure enqueue gate for extraction output — 修订案 №4 §3.2「分层入队」.
 *
 * The scarce resource is confirmation attention, not storage. Amendment №4
 * rejects the three tempting fixes at the *exit* (auto-promotion, batch
 * confirm, timeout-adoption) because each of them records "the user did not
 * look" as "the user agreed" — Iron Law 0 says confirmation must be an act of
 * thought, and silence is not an adoption signal. So the gate goes at the
 * *entrance*: extraction decides whether a new node lands as `idea` (visible,
 * quiet, demands nothing) or `pending` (enters the Judgment Inbox). Exit
 * strictness is unchanged — Inbox K8's two gates (needs_discussion, topic
 * assignment) still apply independently to everything that reaches `pending`.
 *
 * Same move as Watchtower K3: decouple the *sweep* frequency from the *alert*
 * frequency. Here: decouple extraction frequency from confirmation frequency.
 *
 * No `server-only`, no DB access — total functions over plain node/edge data,
 * exercised by tests/unit/enqueue-core.test.ts (same split as inbox-core.ts /
 * re-entry-core.ts / patrol-core.ts).
 *
 * This module DECIDES. It never writes: idea→pending always travels through
 * `/api/ir/[id]/promote` (Inbox N1/JI-12, Watchtower N1, №4 §3.2). Nothing here
 * may grow a second write path.
 */

// Premises are the ground other judgments stand on: if one is wrong, everything
// derived from it moves. They earn a ruling even when nothing depends on them
// yet, because by the time something does it is too late to ask cheaply.
const PREMISE_KINDS = new Set<IRKind>(["principle", "constraint", "hypothesis"]);

// Relations by which a candidate reshapes ground that is already confirmed.
// Mirrors inbox-core's RESHAPE_RELATIONS on purpose: the thing that makes a
// candidate Tier-A in the queue is the same thing that earns it a place in the
// queue at all.
const RESHAPE_RELATIONS = new Set<IRRelation>([
  "supersedes",
  "resolves",
  "contradicts",
]);

// Edges by which a node becomes load-bearing: `A depends_on B` / `A refines B`
// is written from A to B, so B gains a dependent when an edge points AT it.
// (Direction confirmed in inbox-core.ts against lib/ir/queries.ts.) `implies`
// stays out for the same reason it does there — its direction is semantically
// reversed and folding it in would corrupt the count.
const DEPENDENCY_RELATIONS = new Set<IRRelation>(["depends_on", "refines"]);

export const ENQUEUE_REASONS = [
  "premise",
  "goal",
  "reshapes_truth",
  "answers_open_question",
  "alert",
] as const;

export type EnqueueReason = (typeof ENQUEUE_REASONS)[number];

export type EnqueueDecision = {
  /** `pending` consumes confirmation attention; `idea` does not. */
  status: "idea" | "pending";
  /**
   * Every criterion that fired, in declaration order. Plural on purpose: §3.4's
   * health metrics need to know *which* criterion is doing the enqueueing when
   * the enqueue rate drifts above 50%, and a single winning reason hides that.
   * Empty ⇒ nothing fired ⇒ `idea`.
   */
  reasons: EnqueueReason[];
};

type EnqueueInput = {
  kind: IRKind;
  sourceLayer: IRNode["sourceLayer"];
  /** Edges written FROM this node. Statuses other than `dismissed` count: a
   * candidate's proposed edges are not confirmed yet, so requiring `active`
   * here would make the criterion unreachable. */
  outgoingEdges: Pick<IREdge, "relation" | "toNode" | "status">[];
  /** Every node the outgoing edges can point at, by id. */
  nodesById: Map<string, Pick<IRNode, "id" | "kind" | "status">>;
};

/**
 * §3.2 criteria — any hit ⇒ `pending`, none ⇒ `idea`.
 *
 * Deliberately structural. "Does this reshape existing truth?" is answered by
 * looking at edges and target status, not by asking a model to judge tone. The
 * one genuinely semantic call (was the *right* reshape edge extracted at all?)
 * belongs to the extraction layer upstream of this function; §4.3 keeps model
 * calls for decisions that actually need judgment.
 */
export function decideEnqueue({
  kind,
  sourceLayer,
  outgoingEdges,
  nodesById,
}: EnqueueInput): EnqueueDecision {
  const reasons: EnqueueReason[] = [];

  if (PREMISE_KINDS.has(kind)) {
    reasons.push("premise");
  }

  // №1 §5.3: a candidate goal goes to the pending lane "like any other
  // candidate, through the same confirmation regime". Without this line goals
  // would silently fall into `idea` and quietly become anchors.
  if (kind === "goal") {
    reasons.push("goal");
  }

  let reshapesTruth = false;
  let answersOpenQuestion = false;

  for (const edge of outgoingEdges) {
    if (edge.status === "dismissed") {
      continue;
    }

    const target = nodesById.get(edge.toNode);

    if (!target || target.status === "dismissed") {
      continue;
    }

    if (RESHAPE_RELATIONS.has(edge.relation) && target.status === "active") {
      reshapesTruth = true;
    }

    // Non-redundant with the rule above only when the question is not yet
    // `active` — an open question the user raised but has not confirmed still
    // counts as "I am waiting for this", and an answer to it deserves a ruling.
    if (edge.relation === "resolves" && target.kind === "open_question") {
      answersOpenQuestion = true;
    }
  }

  if (reshapesTruth) {
    reasons.push("reshapes_truth");
  }

  if (answersOpenQuestion) {
    reasons.push("answers_open_question");
  }

  if (sourceLayer === "watchtower" || sourceLayer === "research") {
    reasons.push("alert");
  }

  return {
    status: reasons.length > 0 ? "pending" : "idea",
    reasons,
  };
}

export const UPGRADE_TRIGGERS = [
  "gained_dependent",
  "referenced_by_user",
  "manual_promote",
] as const;

export type UpgradeTrigger = (typeof UPGRADE_TRIGGERS)[number];

/**
 * §3.2 dynamic upgrade — the answer to "extraction could not yet tell whether
 * this would become load-bearing".
 *
 * Load-bearing is decided over time, not once at write. The moment an `idea`
 * actually starts holding something up, it owes the user a ruling. Note what
 * is NOT a trigger: elapsed time. An idea nobody built on and nobody cited is
 * not more true for having sat there a month.
 *
 * `referenced_by_user` is a *behavioural* signal and it upgrades into the
 * queue — it never counts as the confirmation itself. "The user reasoned from
 * it" means "this now deserves your attention", not "the user approved it".
 * Collapsing those two is exactly the failure §3.1 threw out.
 */
export function detectUpgradeTriggers({
  nodeId,
  status,
  incomingEdges,
  referencedByUser = false,
  manualPromote = false,
}: {
  nodeId: string;
  status: IRNode["status"];
  /** Edges pointing AT this node (from-node depends on / refines it). */
  incomingEdges: Pick<IREdge, "fromNode" | "toNode" | "relation" | "status">[];
  referencedByUser?: boolean;
  manualPromote?: boolean;
}): UpgradeTrigger[] {
  if (status !== "idea") {
    return [];
  }

  const triggers: UpgradeTrigger[] = [];

  const hasDependent = incomingEdges.some(
    (edge) =>
      edge.toNode === nodeId &&
      edge.status !== "dismissed" &&
      DEPENDENCY_RELATIONS.has(edge.relation)
  );

  if (hasDependent) {
    triggers.push("gained_dependent");
  }

  if (referencedByUser) {
    triggers.push("referenced_by_user");
  }

  if (manualPromote) {
    triggers.push("manual_promote");
  }

  return triggers;
}

export function shouldPromoteToPending(
  triggers: UpgradeTrigger[]
): triggers is [UpgradeTrigger, ...UpgradeTrigger[]] {
  return triggers.length > 0;
}

/** §3.4 — the gate's own health, and the condition under which it is scrapped. */
export const ENQUEUE_RATE_CEILING = 0.5;
export const IDEA_UPGRADE_RATE_CEILING = 0.3;

export type GateHealth = {
  enqueueRate: number;
  ideaUpgradeRate: number;
  /** Gate is not holding anything back — criteria too wide. */
  enqueueRateBreached: boolean;
  /** Criteria are missing genuinely load-bearing nodes — too narrow. */
  upgradeRateBreached: boolean;
  /**
   * Both at once means the criteria are not separating anything: the gate lets
   * most things through AND misclassifies much of the rest. §3.4 pre-commits to
   * reverting to full enqueueing and redesigning the criteria rather than
   * tuning thresholds — written down so this layering can be falsified.
   */
  shouldRevertToFullEnqueue: boolean;
};

export function evaluateGateHealth({
  pendingCreated,
  totalCreated,
  ideaUpgraded,
  ideaTotal,
}: {
  pendingCreated: number;
  totalCreated: number;
  ideaUpgraded: number;
  ideaTotal: number;
}): GateHealth {
  const enqueueRate = totalCreated > 0 ? pendingCreated / totalCreated : 0;
  const ideaUpgradeRate = ideaTotal > 0 ? ideaUpgraded / ideaTotal : 0;

  const enqueueRateBreached = enqueueRate > ENQUEUE_RATE_CEILING;
  const upgradeRateBreached = ideaUpgradeRate > IDEA_UPGRADE_RATE_CEILING;

  return {
    enqueueRate,
    ideaUpgradeRate,
    enqueueRateBreached,
    upgradeRateBreached,
    shouldRevertToFullEnqueue: enqueueRateBreached && upgradeRateBreached,
  };
}
