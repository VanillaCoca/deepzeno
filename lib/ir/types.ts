export const irKinds = [
  "goal",
  "constraint",
  "plan",
  "hypothesis",
  "principle",
  "open_question",
  "rejection",
  "unclassified",
] as const;

export const irPlanSubtypes = ["decision", "task", "milestone"] as const;

export const irStatuses = [
  "idea",
  "pending",
  "active",
  "superseded",
  "dismissed",
] as const;

export const irSourceLayers = [
  "inline",
  "sweep",
  "manual",
  "mcp",
  "kickoff",
  "research",
] as const;

export const irCreatedByValues = ["ai", "user", "mcp"] as const;

export const irRelations = [
  "supersedes",
  "resolves",
  "depends_on",
  "implies",
  "contradicts",
  "refines",
] as const;

export type IRKind = (typeof irKinds)[number];
export type IRPlanSubtype = (typeof irPlanSubtypes)[number];
export type IRStatus = (typeof irStatuses)[number];
export type IRSourceLayer = (typeof irSourceLayers)[number];
export type IRCreatedBy = (typeof irCreatedByValues)[number];
export type IRRelation = (typeof irRelations)[number];

export type IRNode = {
  id: string;
  projectId: string;
  topicId: string | null;
  parentId: string | null;
  kind: IRKind;
  subtype: IRPlanSubtype | null;
  status: IRStatus;
  title: string;
  content: string | null;
  rationale: string | null;
  sensitivity: "normal" | "vault";
  sourceChatId: string | null;
  sourceTurnId: string | null;
  sourceTextSpan: string | null;
  sourceLayer: IRSourceLayer | null;
  importSessionId: string | null;
  reactivationAnchorId: string | null;
  extractionConfidence: number | null;
  createdAt: string;
  promotedToPendingAt: string | null;
  confirmedAt: string | null;
  supersededAt: string | null;
  supersededBy: string | null;
  createdBy: IRCreatedBy;
  confirmedBy: string | null;
  confirmability?: {
    status: "ready" | "needs_discussion";
    reason: string | null;
  } | null;
};

export type IREdge = {
  id: string;
  projectId: string;
  fromNode: string;
  toNode: string;
  relation: IRRelation;
  status: "pending" | "active" | "dismissed";
  isAnchorHint: boolean;
  createdAt: string;
  confirmedAt: string | null;
};

export type IRDetail = {
  node: IRNode;
  edges: IREdge[];
  relatedNodes: IRNode[];
};

export type IRRelationInput = {
  relation: IRRelation;
  toNode: string;
  isAnchorHint?: boolean;
};

const PREFIX_MAP: Record<string, string> = {
  "goal:_": "G",
  "constraint:_": "C",
  "plan:decision": "D",
  "plan:task": "T",
  "plan:milestone": "M",
  "hypothesis:_": "H",
  "principle:_": "R",
  "open_question:_": "Q",
  "rejection:_": "X",
  "unclassified:_": "U",
};

export function isIRKind(value: string): value is IRKind {
  return (irKinds as readonly string[]).includes(value);
}

export function isIRStatus(value: string): value is IRStatus {
  return (irStatuses as readonly string[]).includes(value);
}

export function isIRRelation(value: string): value is IRRelation {
  return (irRelations as readonly string[]).includes(value);
}

export function getIRPrefix(kind: IRKind, subtype?: IRPlanSubtype | null) {
  const key = `${kind}:${subtype ?? "_"}`;
  return PREFIX_MAP[key] ?? "U";
}

export function validateIRKindSubtype(
  kind: IRKind,
  subtype?: IRPlanSubtype | null
) {
  if (kind === "plan") {
    return Boolean(subtype && irPlanSubtypes.includes(subtype));
  }

  return !subtype;
}

export function getIRTypeLabel(kind: IRKind, subtype?: IRPlanSubtype | null) {
  if (kind === "plan" && subtype === "decision") {
    return "Decision";
  }

  if (kind === "plan" && subtype === "task") {
    return "Task";
  }

  if (kind === "plan" && subtype === "milestone") {
    return "Milestone";
  }

  switch (kind) {
    case "goal":
      return "Goal";
    case "constraint":
      return "Constraint";
    case "hypothesis":
      return "Hypothesis";
    case "principle":
      return "Principle";
    case "open_question":
      return "Open Question";
    case "rejection":
      return "Rejection";
    case "unclassified":
      return "Unclassified";
    default:
      return kind;
  }
}

export function getIRGroupLabel(kind: IRKind, subtype?: IRPlanSubtype | null) {
  const label = getIRTypeLabel(kind, subtype);
  return label.endsWith("s") ? label : `${label}s`;
}

export function truncateIRTitle(title: string, maxLength: number) {
  const normalized = title.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function normalizeIRTitle(title: string) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}
