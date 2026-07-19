// Pure types — importable from client components (watch-queries.ts is
// server-only; its row mappers produce these shapes).

import type { PatrolCadence } from "./agent-settings";

export type WatchOrigin = "zeno_suggested" | "user_requested";
export type WatchStatus = "active" | "paused";

// One exploration angle the agent plans to (or did) pursue for a watched
// assumption. Same shape as a research_run plan intent, so the two render
// interchangeably on the exploration board.
export type ExplorationDirection = {
  query: string;
  goal: string;
};

// Runtime guard shared by server mappers and client components; tolerates
// pre-migration rows and malformed jsonb by rejecting them wholesale.
export function isExplorationDirectionArray(
  value: unknown
): value is ExplorationDirection[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { query?: unknown }).query === "string" &&
        typeof (item as { goal?: unknown }).goal === "string"
    )
  );
}

export type IRWatch = {
  id: string;
  projectId: string;
  nodeId: string;
  origin: WatchOrigin;
  reason: string;
  cadence: PatrolCadence;
  status: WatchStatus;
  modelId: string | null;
  // Patrol-proposed directions for the next visit; null before the first
  // patrol writes them (or pre-migration).
  nextDirections: ExplorationDirection[] | null;
  lastPatrolAt: string | null;
  lastSignalAt: string | null;
  lastAlertAt: string | null;
  nextDueAt: string;
  createdAt: string;
  updatedAt: string;
};
