/**
 * Truth Tree v1.3 visual grammar — character constants and lookup helpers.
 * See docs/ir-ui-interaction-v1.3.md §2.
 *
 * All glyphs are BMP unicode and intended to render in monospace fonts
 * (Geist Mono / JetBrains Mono). If a glyph renders poorly on Windows
 * default fonts, swap it here — every renderer reads these constants.
 */

import type { IRKind, IRPlanSubtype, IRRelation, IRStatus } from "@/lib/ir/types";

// ============================================================================
// Status — row head, 1 char
// ============================================================================

export const STATUS_GLYPH: Record<IRStatus, string> = {
  active: "●",
  pending: "○",
  idea: "◐",
  superseded: "⊘",
  dismissed: "·",
};

export const STATUS_OPACITY: Record<IRStatus, number> = {
  active: 1,
  pending: 1,
  idea: 0.7,
  superseded: 0.5,
  dismissed: 0.3,
};

export function getStatusGlyph(status: IRStatus): string {
  return STATUS_GLYPH[status] ?? "·";
}

// ============================================================================
// Kind — glyph + 4-char code (left-padded for monospace alignment)
// ============================================================================

type KindKey =
  | IRKind
  | "plan_decision"
  | "plan_task"
  | "plan_milestone";

const KIND_GLYPH: Record<KindKey, string> = {
  goal: "◆",
  plan: "▣", // bare 'plan' fallback; subtypes specialize below
  plan_decision: "▣",
  plan_task: "☐",
  plan_milestone: "▲",
  constraint: "▮",
  principle: "§",
  hypothesis: "◌",
  open_question: "?",
  rejection: "⊘",
  unclassified: "·",
};

const KIND_CODE: Record<KindKey, string> = {
  goal: "goal",
  plan: "plan",
  plan_decision: "dec ",
  plan_task: "task",
  plan_milestone: "mst ",
  constraint: "cstr",
  principle: "prn ",
  hypothesis: "hyp ",
  open_question: "q   ",
  rejection: "rej ",
  unclassified: "?   ",
};

// CSS var names matching docs §8.5
export const KIND_COLOR_VAR: Partial<Record<KindKey, string>> = {
  goal: "--ir-glyph-goal",
  plan_decision: "--ir-glyph-decision",
  plan_task: "--ir-glyph-decision",
  plan_milestone: "--ir-glyph-decision",
  constraint: "--ir-glyph-constraint",
  principle: "--ir-glyph-principle",
  hypothesis: "--ir-glyph-hypothesis",
  open_question: "--ir-glyph-question",
  rejection: "--ir-glyph-rejection",
};

function kindKey(kind: IRKind, subtype: IRPlanSubtype | null): KindKey {
  if (kind === "plan" && subtype) {
    return `plan_${subtype}` as KindKey;
  }
  return kind;
}

export function getKindGlyph(kind: IRKind, subtype: IRPlanSubtype | null): string {
  return KIND_GLYPH[kindKey(kind, subtype)] ?? "·";
}

export function getKindCode(kind: IRKind, subtype: IRPlanSubtype | null): string {
  return KIND_CODE[kindKey(kind, subtype)] ?? "?   ";
}

export function getKindColorVar(
  kind: IRKind,
  subtype: IRPlanSubtype | null
): string | null {
  return KIND_COLOR_VAR[kindKey(kind, subtype)] ?? null;
}

// ============================================================================
// Edge — connector char on the line between parent and child
// Specialized by (relation × parent.kind) per spec §2.3.
// ============================================================================

const EDGE_GLYPH_BASE: Record<IRRelation, string> = {
  implies: "►",
  depends_on: "┊",
  resolves: "‖",
  refines: "◇",
  contradicts: "↯",
  supersedes: "", // not rendered in tree
};

export function getEdgeGlyph(
  relation: IRRelation,
  parentKind: IRKind | null
): string {
  // Specializations (data stays at 6 enum, rendering disambiguates):
  if (relation === "depends_on" && parentKind === "constraint") {
    return "━";
  }
  if (relation === "implies" && parentKind === "hypothesis") {
    return "◌";
  }
  return EDGE_GLYPH_BASE[relation] ?? "";
}

// CSS var names for edge colors (docs §8.5)
export function getEdgeColorVar(relation: IRRelation): string | null {
  if (relation === "contradicts") {
    return "--ir-edge-contradicts";
  }
  return null; // others use default foreground/muted
}

// ============================================================================
// Indent guides
// ============================================================================

export const INDENT_VERTICAL = "│";
export const INDENT_T = "├";
export const INDENT_L = "└";
export const INDENT_BLANK = " ";

// ============================================================================
// Relations to ignore for tree shape
// ============================================================================

/**
 * Relations that affect tree parent-child structure.
 * `supersedes` lives in the version chain (Detail pane).
 * `contradicts` is bidirectional and doesn't pick a parent.
 */
export const TREE_SHAPE_RELATIONS: ReadonlySet<IRRelation> = new Set([
  "implies",
  "depends_on",
  "refines",
  "resolves",
] as const);

/**
 * Priority for primary-parent selection (lower index = higher priority).
 * From spec §4.2.
 */
export const RELATION_PRIORITY: ReadonlyMap<IRRelation, number> = new Map([
  ["implies", 0],
  ["depends_on", 1],
  ["refines", 2],
  ["resolves", 3],
  // contradicts and supersedes never picked as primary
]);
