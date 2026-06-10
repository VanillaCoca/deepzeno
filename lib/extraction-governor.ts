// Extraction volume governor (constitution principle 2a): investigation
// volume must never linearly convert into confirmation requests. Every
// AI extraction path admits at most a fixed number of candidates per run,
// and when the user's pending confirmation pool is backlogged the
// admission bar rises so only high-confidence items keep arriving.

export type GovernorConfig = {
  /** Max candidates one chat extraction run may admit. */
  maxExtractionCandidates: number;
  /** Max pending IR candidates one sweep run may create. */
  maxSweepPending: number;
  /** Max ideas one sweep run may create. */
  maxSweepIdeas: number;
  /** Pending-pool size at which backpressure kicks in. */
  pendingPoolSoftCap: number;
  /** Minimum confidence admitted while backpressured. */
  backpressureMinConfidence: number;
};

export const GOVERNOR_DEFAULTS: GovernorConfig = {
  maxExtractionCandidates: 5,
  maxSweepPending: 6,
  maxSweepIdeas: 8,
  pendingPoolSoftCap: 12,
  backpressureMinConfidence: 0.75,
};

function readPositiveNumber(raw: string | undefined, fallback: number) {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveGovernorConfig(
  env: Record<string, string | undefined> = process.env
): GovernorConfig {
  return {
    maxExtractionCandidates: readPositiveNumber(
      env.ZENO_GOVERNOR_MAX_EXTRACTION_CANDIDATES,
      GOVERNOR_DEFAULTS.maxExtractionCandidates
    ),
    maxSweepPending: readPositiveNumber(
      env.ZENO_GOVERNOR_MAX_SWEEP_PENDING,
      GOVERNOR_DEFAULTS.maxSweepPending
    ),
    maxSweepIdeas: readPositiveNumber(
      env.ZENO_GOVERNOR_MAX_SWEEP_IDEAS,
      GOVERNOR_DEFAULTS.maxSweepIdeas
    ),
    pendingPoolSoftCap: readPositiveNumber(
      env.ZENO_GOVERNOR_PENDING_POOL_SOFT_CAP,
      GOVERNOR_DEFAULTS.pendingPoolSoftCap
    ),
    backpressureMinConfidence: readPositiveNumber(
      env.ZENO_GOVERNOR_BACKPRESSURE_MIN_CONFIDENCE,
      GOVERNOR_DEFAULTS.backpressureMinConfidence
    ),
  };
}

export function governExtractionCandidates<T extends { confidence: number }>(
  candidates: T[],
  {
    maxCandidates,
    backpressured,
    minConfidence,
  }: {
    maxCandidates: number;
    backpressured: boolean;
    minConfidence: number;
  }
): { admitted: T[]; droppedByBackpressure: number; droppedByCap: number } {
  const aboveBar = backpressured
    ? candidates.filter((candidate) => candidate.confidence >= minConfidence)
    : candidates;
  const droppedByBackpressure = candidates.length - aboveBar.length;
  const admitted = [...aboveBar]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxCandidates);

  return {
    admitted,
    droppedByBackpressure,
    droppedByCap: aboveBar.length - admitted.length,
  };
}
