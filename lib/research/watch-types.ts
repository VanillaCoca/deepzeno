// Pure types — importable from client components (watch-queries.ts is
// server-only; its row mappers produce these shapes).

import type { PatrolCadence } from "./agent-settings";

export type WatchOrigin = "zeno_suggested" | "user_requested";
export type WatchStatus = "active" | "paused";

export type IRWatch = {
  id: string;
  projectId: string;
  nodeId: string;
  origin: WatchOrigin;
  reason: string;
  cadence: PatrolCadence;
  status: WatchStatus;
  modelId: string | null;
  lastPatrolAt: string | null;
  lastSignalAt: string | null;
  lastAlertAt: string | null;
  nextDueAt: string;
  createdAt: string;
  updatedAt: string;
};
