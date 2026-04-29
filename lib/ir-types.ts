export type IRType =
  | "goal"
  | "constraint"
  | "hypothesis"
  | "open_question"
  | "plan"
  | "principle"
  | "rejection";

export interface IRTypeCopy {
  label: string;
  definition: string;
  example: string;
}

export const IR_TYPE_COPY: Record<IRType, IRTypeCopy> = {
  goal: {
    label: "goal",
    definition: "A specific outcome you're working toward.",
    example: "Reach Re-entry Success Rate L3 by 2027 Q4.",
  },
  constraint: {
    label: "constraint",
    definition: "A boundary every solution must respect. Often non-negotiable.",
    example: "Never own the execution environment.",
  },
  hypothesis: {
    label: "hypothesis",
    definition: "A belief you're acting on but haven't fully validated.",
    example: "MCP server is the right distribution channel.",
  },
  open_question: {
    label: "open question",
    definition:
      "An unresolved decision waiting for input. Resolves when you commit.",
    example: "Pricing tier thresholds — exact numbers.",
  },
  plan: {
    label: "plan",
    definition:
      "A sequence of intended actions. Often superseded as you learn.",
    example: "Launch domestic-first, then expand to Hong Kong.",
  },
  principle: {
    label: "principle",
    definition: "A reusable rule that guides many decisions.",
    example: "宁漏勿错 — preserve trust over recall.",
  },
  rejection: {
    label: "rejection",
    definition: "A choice you considered and explicitly decided against.",
    example: "We will not build a consumer chat view.",
  },
};

export const humanLabel = (type: IRType): string => IR_TYPE_COPY[type].label;
