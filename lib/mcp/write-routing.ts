export type WriteRoute = "direct" | "candidate";

type TargetDecisionForRouting = {
  confirmed_by_user_id: string | null;
  weight: string;
  kind: string;
};

const candidateOnlyKinds = new Set(["rejection", "constraint"]);

function isUserConfirmedHighWeight(targetDecision?: TargetDecisionForRouting) {
  return Boolean(
    targetDecision?.confirmed_by_user_id && targetDecision.weight === "high"
  );
}

export function classifyWrite(input: {
  tool: string;
  proposed_kind?: string;
  target_decision?: TargetDecisionForRouting;
  next_kind?: string;
}): WriteRoute {
  if (input.proposed_kind && candidateOnlyKinds.has(input.proposed_kind)) {
    return "candidate";
  }

  if (input.next_kind && candidateOnlyKinds.has(input.next_kind)) {
    return "candidate";
  }

  if (
    (input.tool === "supersede_decision" ||
      input.tool === "archive_decision") &&
    isUserConfirmedHighWeight(input.target_decision)
  ) {
    return "candidate";
  }

  return "direct";
}
