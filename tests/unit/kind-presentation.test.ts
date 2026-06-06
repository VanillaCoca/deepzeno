import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kindPresentation } from "../../components/ir/kind-presentation.ts";

describe("kindPresentation", () => {
  it("uses the natural human label, not the code id", () => {
    assert.equal(kindPresentation("plan", "decision").label, "Decision");
    assert.equal(kindPresentation("goal", null).label, "Goal");
    assert.equal(
      kindPresentation("open_question", null).label,
      "Open question"
    );
  });
  it("maps semantic colours: decision green, open question amber, hypothesis purple, others neutral", () => {
    assert.equal(
      kindPresentation("plan", "decision").color,
      "var(--z-confirmed)"
    );
    assert.equal(
      kindPresentation("open_question", null).color,
      "var(--z-attention)"
    );
    assert.equal(
      kindPresentation("hypothesis", null).color,
      "var(--z-candidate)"
    );
    assert.equal(
      kindPresentation("constraint", null).color,
      "var(--z-node-stroke)"
    );
  });
});
