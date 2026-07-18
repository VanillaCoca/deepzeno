import { resolvePatrolBudget } from "@/lib/research/patrol-core";

// Daily Watchtower sweep (vercel.json crons). Processes due watches oldest
// first within one invocation; anything left over is first in line next
// time (next_due_at ordering is the continuation cursor). Auth: Vercel
// sends `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Lazy imports keep the auth failure path free of DB/module init.
  const { listDueWatches } = await import("@/lib/research/watch-queries");
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

  const results: Array<{ watchId: string; status: string }> = [];
  for (const watch of due) {
    // Sequential on purpose: patrols share the model/search budget and a
    // single failure must not abort the sweep.
    const result = await runPatrolForWatch({ watchId: watch.id });
    results.push({ watchId: result.watchId, status: result.status });
  }

  console.info(
    JSON.stringify({ type: "watchtower_sweep", due: due.length, results })
  );
  return Response.json({ processed: due.length, results });
}
