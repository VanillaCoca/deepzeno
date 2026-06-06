import type { IRKind, IRPlanSubtype } from "../../lib/ir/types.ts";
import { getIRTypeLabel } from "../../lib/ir/types.ts";

export function kindPresentation(
  kind: IRKind,
  subtype: IRPlanSubtype | null
): { label: string; color: string } {
  const rawLabel = getIRTypeLabel(kind, subtype);
  const label =
    rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase();
  let color = "var(--z-node-stroke)";
  if (kind === "plan" && subtype === "decision") {
    color = "var(--z-confirmed)";
  } else if (kind === "open_question") {
    color = "var(--z-attention)";
  } else if (kind === "hypothesis") {
    color = "var(--z-candidate)";
  } else if (kind === "rejection") {
    color = "var(--z-rejected)";
  }
  return { label, color };
}
