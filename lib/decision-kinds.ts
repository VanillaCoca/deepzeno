export const decisionKindOrder = [
  "open_question",
  "goal",
  "constraint",
  "plan",
  "hypothesis",
  "principle",
  "rejection",
] as const;

export const UNCLASSIFIED_KIND = "unclassified" as const;

export type ClassifiedDecisionKind = (typeof decisionKindOrder)[number];
export type DecisionKind = ClassifiedDecisionKind | typeof UNCLASSIFIED_KIND;

export function isDecisionKind(value: string): value is DecisionKind {
  return (
    value === UNCLASSIFIED_KIND ||
    (decisionKindOrder as readonly string[]).includes(value)
  );
}

export function getDecisionKindLabel(kind: string) {
  switch (kind) {
    case "open_question":
      return "Open Questions";
    case "goal":
      return "Goals";
    case "constraint":
      return "Constraints";
    case "plan":
      return "Plans";
    case "hypothesis":
      return "Hypotheses";
    case "principle":
      return "Principles";
    case "rejection":
      return "Rejections";
    default:
      return kind;
  }
}

export function getDecisionKindBadgeLabel(kind: string) {
  switch (kind) {
    case "open_question":
      return "open question";
    default:
      return kind;
  }
}

export function getDecisionKindTone(kind: string) {
  switch (kind) {
    case "open_question":
      return "bg-amber-500/10 text-amber-700 border-amber-500/25";
    case "goal":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
    case "constraint":
      return "bg-orange-500/10 text-orange-700 border-orange-500/20";
    case "plan":
      return "bg-violet-500/10 text-violet-700 border-violet-500/20";
    case "hypothesis":
      return "bg-sky-500/10 text-sky-700 border-sky-500/20";
    case "principle":
      return "bg-blue-500/10 text-blue-700 border-blue-500/20";
    case "rejection":
      return "bg-zinc-500/10 text-zinc-700 border-zinc-500/25";
    default:
      return "bg-muted text-muted-foreground border-border/60";
  }
}
