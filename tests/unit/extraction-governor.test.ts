import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GOVERNOR_DEFAULTS,
  governExtractionCandidates,
  resolveGovernorConfig,
} from "../../lib/extraction-governor.ts";

describe("resolveGovernorConfig", () => {
  it("falls back to defaults when env is empty", () => {
    assert.deepEqual(resolveGovernorConfig({}), GOVERNOR_DEFAULTS);
  });

  it("reads numeric overrides from env", () => {
    const config = resolveGovernorConfig({
      ZENO_GOVERNOR_MAX_EXTRACTION_CANDIDATES: "3",
      ZENO_GOVERNOR_MAX_SWEEP_PENDING: "4",
      ZENO_GOVERNOR_MAX_SWEEP_IDEAS: "5",
      ZENO_GOVERNOR_PENDING_POOL_SOFT_CAP: "20",
      ZENO_GOVERNOR_BACKPRESSURE_MIN_CONFIDENCE: "0.9",
    });

    assert.equal(config.maxExtractionCandidates, 3);
    assert.equal(config.maxSweepPending, 4);
    assert.equal(config.maxSweepIdeas, 5);
    assert.equal(config.pendingPoolSoftCap, 20);
    assert.equal(config.backpressureMinConfidence, 0.9);
  });

  it("rejects non-numeric and non-positive overrides", () => {
    const config = resolveGovernorConfig({
      ZENO_GOVERNOR_MAX_EXTRACTION_CANDIDATES: "lots",
      ZENO_GOVERNOR_PENDING_POOL_SOFT_CAP: "-1",
      ZENO_GOVERNOR_BACKPRESSURE_MIN_CONFIDENCE: "0",
    });

    assert.equal(
      config.maxExtractionCandidates,
      GOVERNOR_DEFAULTS.maxExtractionCandidates
    );
    assert.equal(
      config.pendingPoolSoftCap,
      GOVERNOR_DEFAULTS.pendingPoolSoftCap
    );
    assert.equal(
      config.backpressureMinConfidence,
      GOVERNOR_DEFAULTS.backpressureMinConfidence
    );
  });
});

describe("governExtractionCandidates", () => {
  const candidates = [
    { id: "a", confidence: 0.9 },
    { id: "b", confidence: 0.6 },
    { id: "c", confidence: 0.8 },
    { id: "d", confidence: 0.5 },
  ];

  it("admits everything under the cap without backpressure", () => {
    const result = governExtractionCandidates(candidates, {
      maxCandidates: 5,
      backpressured: false,
      minConfidence: 0.75,
    });

    assert.equal(result.admitted.length, 4);
    assert.equal(result.droppedByBackpressure, 0);
    assert.equal(result.droppedByCap, 0);
  });

  it("keeps the highest-confidence candidates when over the cap", () => {
    const result = governExtractionCandidates(candidates, {
      maxCandidates: 2,
      backpressured: false,
      minConfidence: 0.75,
    });

    assert.deepEqual(
      result.admitted.map((candidate) => candidate.id),
      ["a", "c"]
    );
    assert.equal(result.droppedByCap, 2);
  });

  it("raises the admission bar when backpressured", () => {
    const result = governExtractionCandidates(candidates, {
      maxCandidates: 5,
      backpressured: true,
      minConfidence: 0.75,
    });

    assert.deepEqual(
      result.admitted.map((candidate) => candidate.id),
      ["a", "c"]
    );
    assert.equal(result.droppedByBackpressure, 2);
    assert.equal(result.droppedByCap, 0);
  });
});
