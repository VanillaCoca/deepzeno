import { resolvePatrolBudget } from "@/lib/research/patrol-core";
import { summarizePatrolQueue } from "@/lib/research/patrol-queue-core";
import { SWEEP_EVENT } from "@/lib/research/sweep-capacity-core";

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
  const { countPatrolQueue, listDueWatches, measureSweepCapacity } =
    await import("@/lib/research/watch-queries");
  const { runPatrolForWatch } = await import("@/lib/research/patrol");
  const { logIREvent } = await import("@/lib/ir/queries");

  const budget = resolvePatrolBudget();
  let due: Awaited<ReturnType<typeof listDueWatches>>;
  try {
    // Deliberately the configured cap, never the measured capacity. Sizing the
    // fetch by the estimate would destroy the estimate: hand the sweep exactly
    // what it can finish and `deferred` is always 0, no sweep ever measures its
    // own ceiling, and the number decays back to the assertion it replaced.
    // Over-fetching is what makes the ceiling observable.
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
  //
  // Capacity is what previous sweeps actually finished, not
  // `maxWatchesPerSweep × sweepsPerDay` (see sweep-capacity-core). On this
  // deployment the two differ threefold, and the asserted one is larger — so
  // every backlog number derived from it was reassuring and wrong.
  const [capacity, counts] = await Promise.all([
    measureSweepCapacity(budget),
    countPatrolQueue().catch(() => null),
  ]);
  const queue = counts
    ? summarizePatrolQueue({
        activeWatches: counts.active,
        dueNow: counts.due,
        dailyCapacity: capacity.perDay,
      })
    : null;

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
  // that finishes early take the next watch immediately.
  //
  // That argument is sound and its predicted effect has not materialised. Seven
  // consecutive production sweeps with four lanes finished 8, 8, 8, 8, 8, 7, 8
  // — the same throughput as the serial loop, with completions spaced evenly
  // ~35s apart rather than arriving in bursts of four. Something downstream is
  // serialising the lanes, most likely the model provider serving one request
  // per deployment at a time. Left in place because it costs nothing and pays
  // off the moment that ceiling lifts, but nothing here should be read as
  // evidence that concurrency is working. `capacity` below is what to believe.
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

  const elapsedMs = Date.now() - invocationStartedAt;

  // The sweep's account of itself, kept rather than printed.
  //
  // This is the whole fix. `processed` and `deferred` were already computed and
  // already logged; the defect was that a log line is not a record, so every
  // sweep re-derived capacity from a constant while the evidence to correct it
  // scrolled past. Persisted, tomorrow's sweep reads today's.
  //
  // The pair is what carries the information — `processed` alone is censored
  // from above, since a sweep that cleared its queue reports the queue, not its
  // ceiling. `deferred > 0` is what marks an observation as load-bearing.
  //
  // Written after the patrols, deliberately: a sweep killed mid-flight leaves
  // no row, which reads downstream as a missing day rather than as a capacity
  // of zero. `logIREvent` never throws, so telemetry cannot fail a sweep that
  // has already done its work.
  await logIREvent({
    event: SWEEP_EVENT,
    layer: "watchtower",
    metadata: {
      due: due.length,
      processed: results.length,
      deferred,
      concurrency: budget.sweepConcurrency,
      elapsed_ms: elapsedMs,
    },
  });

  // `due` is capped at maxWatchesPerSweep, so it says nothing about how much
  // work was waiting — it is the same number every day once the queue is
  // saturated. `queue` is what actually distinguishes "keeping up" from
  // "thirty days behind", and without it the sweep log looks identical in both
  // cases. `deferred` separates the third case that otherwise hides inside the
  // other two: the queue is fine and the cap is fine, but the invocation ran
  // out of clock. That one is fixed by raising concurrency, not by raising the
  // cap, and no other number in this log tells them apart. `capacity` says
  // which of those numbers the schedule was actually built on, and whether it
  // was measured or merely assumed.
  console.info(
    JSON.stringify({
      type: SWEEP_EVENT,
      due: due.length,
      processed: results.length,
      deferred,
      concurrency: budget.sweepConcurrency,
      elapsed_ms: elapsedMs,
      capacity,
      queue,
      results,
    })
  );
  return Response.json({
    processed: results.length,
    deferred,
    capacity,
    queue,
    results,
  });
}
