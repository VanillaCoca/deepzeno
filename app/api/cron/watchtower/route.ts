import { resolvePatrolBudget } from "@/lib/research/patrol-core";
import { summarizePatrolQueue } from "@/lib/research/patrol-queue-core";

// Daily Watchtower sweep (vercel.json crons). Processes due watches oldest
// first within one invocation; anything left over is first in line next
// time (next_due_at ordering is the continuation cursor). Auth: Vercel
// sends `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
export const maxDuration = 300;

// The last moment at which starting another patrol is still safe.
//
// A lane that picks up a watch runs it to completion — a patrol cannot be
// interrupted mid-way without leaving its run row `running` and its evidence
// half-written — so the guard has to be about *starting* work, not about
// finishing it. Patrols cost roughly 40-80s in practice; 90s of headroom
// covers the slow tail without throwing away a third of the window. Derived
// from maxDuration rather than written as a second constant, because the two
// drifting apart is a silent failure: the sweep would keep starting patrols it
// gets killed in the middle of, and look like it was merely slow.
const PATROL_START_HEADROOM_MS = 90_000;
const START_DEADLINE_MS = maxDuration * 1000 - PATROL_START_HEADROOM_MS;

export async function GET(request: Request) {
  // Taken before auth and the queue queries, not at the loop, so the deadline
  // below measures the invocation Vercel is actually timing.
  const invocationStartedAt = Date.now();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Lazy imports keep the auth failure path free of DB/module init.
  const { countPatrolQueue, listDueWatches } = await import(
    "@/lib/research/watch-queries"
  );
  const { runPatrolForWatch } = await import("@/lib/research/patrol");

  const budget = resolvePatrolBudget();
  let due: Awaited<ReturnType<typeof listDueWatches>>;
  try {
    due = await listDueWatches(budget.maxWatchesPerSweep);
  } catch (error) {
    // Pre-migration database — report cleanly instead of a 500 storm.
    return Response.json(
      {
        processed: 0,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 200 }
    );
  }

  // Measured before the sweep runs, so it describes the backlog this
  // invocation is facing rather than the dent it just made. Best-effort: a
  // failure to count must not stop patrols, and an uncounted queue is reported
  // as unknown, never as healthy.
  const queue = await countPatrolQueue()
    .then((counts) =>
      summarizePatrolQueue({
        activeWatches: counts.active,
        dueNow: counts.due,
        dailyCapacity: budget.maxWatchesPerSweep * budget.sweepsPerDay,
      })
    )
    .catch(() => null);

  const results: Array<{
    watchId: string;
    status: string;
    detail: string | null;
  }> = [];
  let cursor = 0;
  let deferred = 0;

  // A pool of lanes over one shared cursor, rather than chunking `due` into
  // fixed-size batches. Patrol durations vary by more than a factor of three —
  // a watch whose source pages 404 finishes in seconds, one with three slow
  // fetches and a signal to write up does not — and fixed batches make every
  // lane wait for the slowest member of its batch. A shared cursor lets a lane
  // that finishes early take the next watch immediately, which is the whole
  // reason the same 300-second invocation now reaches ~24 watches instead of 8.
  //
  // Safe as a `Promise.all` only because `runPatrolForWatch` is contractually
  // non-throwing: one rejected lane would abort every other lane in flight.
  const lane = async () => {
    for (;;) {
      if (cursor >= due.length) {
        return;
      }
      if (Date.now() - invocationStartedAt > START_DEADLINE_MS) {
        // Defer rather than start work the invocation will be killed inside.
        // Nothing needs to be written down: a watch that was never picked up
        // still has next_due_at in the past, so it sorts first in the next
        // sweep. The ordering is the continuation cursor.
        deferred += due.length - cursor;
        cursor = due.length;
        return;
      }
      const watch = due[cursor];
      cursor += 1;
      const result = await runPatrolForWatch({ watchId: watch.id });
      results.push({
        watchId: result.watchId,
        status: result.status,
        detail: result.detail,
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(budget.sweepConcurrency, due.length) }, () =>
      lane()
    )
  );

  // `due` is capped at maxWatchesPerSweep, so it says nothing about how much
  // work was waiting — it is the same number every day once the queue is
  // saturated. `queue` is what actually distinguishes "keeping up" from
  // "thirty days behind", and without it the sweep log looks identical in both
  // cases. `deferred` separates the third case that otherwise hides inside the
  // other two: the queue is fine and the cap is fine, but the invocation ran
  // out of clock. That one is fixed by raising concurrency, not by raising the
  // cap, and no other number in this log tells them apart.
  console.info(
    JSON.stringify({
      type: "watchtower_sweep",
      due: due.length,
      processed: results.length,
      deferred,
      concurrency: budget.sweepConcurrency,
      elapsed_ms: Date.now() - invocationStartedAt,
      queue,
      results,
    })
  );
  return Response.json({
    processed: results.length,
    deferred,
    queue,
    results,
  });
}
