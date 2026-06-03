/**
 * Truth Tree v1.3 visual grammar — character constants and lookup helpers.
 * See docs/ir-ui-interaction-v1.3.md §2.
 *
 * Design principle: ONE colored glyph per row (status). Kind is a
 * right-side pill (no glyph). Edges are mostly plain `────` lines;
 * only `resolves`, `contradicts`, and `depends_on with parent.kind=
 * constraint` get an inline label after the title.
 */

import type {
  IRKind,
  IRPlanSubtype,
  IRRelation,
  IRStatus,
} from "@/lib/ir/types";

// ============================================================================
// Status — the only colored glyph in the row body
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
// Kind — code text only (no glyph), rendered as a right-aligned pill
// ============================================================================

type KindKey = IRKind | "plan_decision" | "plan_task" | "plan_milestone";

const KIND_CODE: Record<KindKey, string> = {
  goal: "goal",
  plan: "plan",
  plan_decision: "dec",
  plan_task: "task",
  plan_milestone: "mst",
  constraint: "cstr",
  principle: "prn",
  hypothesis: "hyp",
  open_question: "q",
  rejection: "rej",
  unclassified: "?",
};

// CSS var names for kind pill color hint (docs §8.5)
const KIND_COLOR_VAR: Record<KindKey, string | null> = {
  goal: "--ir-glyph-goal",
  plan: "--ir-glyph-decision",
  plan_decision: "--ir-glyph-decision",
  plan_task: "--ir-glyph-decision",
  plan_milestone: "--ir-glyph-decision",
  constraint: "--ir-glyph-constraint",
  principle: "--ir-glyph-principle",
  hypothesis: "--ir-glyph-hypothesis",
  open_question: "--ir-glyph-question",
  rejection: "--ir-glyph-rejection",
  unclassified: null,
};

function kindKey(kind: IRKind, subtype: IRPlanSubtype | null): KindKey {
  if (kind === "plan" && subtype) {
    return `plan_${subtype}` as KindKey;
  }
  return kind;
}

export function getKindCode(
  kind: IRKind,
  subtype: IRPlanSubtype | null
): string {
  return KIND_CODE[kindKey(kind, subtype)] ?? "?";
}

export function getKindColorVar(
  kind: IRKind,
  subtype: IRPlanSubtype | null
): string | null {
  return KIND_COLOR_VAR[kindKey(kind, subtype)] ?? null;
}

// ============================================================================
// Edge rendering — minimal-by-default with three special cases
// ============================================================================

export type EdgeRendering =
  | { kind: "default" } // plain ──── connector, no inline label
  | { kind: "resolves"; label: "↳ resolves" }
  | { kind: "contradicts"; label: "↯ contradicts" }
  | { kind: "constrained"; label: "· constrained" };

/**
 * Resolves how the edge between (parent, child) should render.
 *
 *   - resolves:    "↳ resolves"   inline label after title
 *   - contradicts: "↯ contradicts" red, inline label
 *   - depends_on AND parent.kind=constraint: "· constrained" amber, inline
 *   - everything else: plain ──── connector, no label
 *   - supersedes: never reaches here (filtered out at tree-shape level)
 */
export function getEdgeRendering(
  relation: IRRelation,
  parentKind: IRKind | null
): EdgeRendering {
  if (relation === "resolves") {
    return { kind: "resolves", label: "↳ resolves" };
  }
  if (relation === "contradicts") {
    return { kind: "contradicts", label: "↯ contradicts" };
  }
  if (relation === "depends_on" && parentKind === "constraint") {
    return { kind: "constrained", label: "· constrained" };
  }
  return { kind: "default" };
}

export function getEdgeLabelColorVar(rendering: EdgeRendering): string | null {
  switch (rendering.kind) {
    case "contradicts":
      return "--ir-edge-contradicts";
    case "constrained":
      return "--ir-glyph-constraint";
    case "resolves":
      return "--ir-glyph-question";
    default:
      return null;
  }
}

// ============================================================================
// Indent guides
// ============================================================================

export const INDENT_VERTICAL = "│";
export const INDENT_T = "├";
export const INDENT_L = "└";
export const CONNECTOR_DASH = "────"; // 4 box-drawing dashes
export const INDENT_BLANK = " ";

// ============================================================================
// Relations to ignore for tree shape
// ============================================================================

/**
 * Relations that affect tree parent-child structure.
 * `supersedes` lives in the version chain (Detail pane).
 * `contradicts` does not pick a parent direction (rendered as label only).
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
]);
