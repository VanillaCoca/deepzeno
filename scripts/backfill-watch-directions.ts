/**
 * One-off repair: fill in next_directions on example watches that were
 * seeded before the 20260719000001 migration landed.
 *
 * Those seeds degraded gracefully — the watch, the radar badge and the
 * exploration board all work — but the three pre-baked exploration angles
 * were dropped, so the board falls back to the research plan until the
 * first patrol proposes its own. This backfills them so every user sees
 * the same example.
 *
 * Idempotent: only touches watches whose next_directions is null, and only
 * those anchored to a node whose title matches the example's watched
 * assumption.
 *
 * Run:
 *   NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/backfill-watch-directions.ts --dry-run
 *   NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/backfill-watch-directions.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const SLUG = "zh-coze-coding";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { getSupabaseAdminClient } = await import("../lib/supabase/admin");
  const { EXAMPLE_PROJECTS } = await import("../lib/workspace/example-content");

  // biome-ignore lint/suspicious/noExplicitAny: untyped admin client.
  const db = getSupabaseAdminClient() as any;

  const spec = EXAMPLE_PROJECTS.find((project) => project.slug === SLUG);
  const entry = spec?.research?.[0];
  const directions = entry?.watch?.nextDirections;
  if (!(spec && entry && directions)) {
    console.error("spec / watch directions not found");
    process.exit(1);
  }

  // The node the example's watch anchors to.
  const watchedTitle = spec.topics
    .flatMap((topic) => topic.nodes)
    .find((node) => node.key === entry.nodeKey)?.title;
  if (!watchedTitle) {
    console.error("watched node not found in spec");
    process.exit(1);
  }

  const { data: nodes, error: nodeError } = await db
    .from("ir_nodes")
    .select("id")
    .eq("title", watchedTitle);
  if (nodeError) {
    console.error("node lookup failed", nodeError);
    process.exit(1);
  }
  const nodeIds = (nodes ?? []).map((n: { id: string }) => n.id);
  console.log(`watched nodes found: ${nodeIds.length}`);
  if (nodeIds.length === 0) {
    process.exit(0);
  }

  const { data: watches, error: watchError } = await db
    .from("ir_watches")
    .select("id,node_id,next_directions")
    .in("node_id", nodeIds);
  if (watchError) {
    console.error("watch lookup failed", watchError);
    process.exit(1);
  }

  const stale = (watches ?? []).filter(
    (w: { next_directions: unknown }) => w.next_directions == null
  );
  console.log(
    `watches: ${watches?.length ?? 0} total, ${stale.length} missing directions`
  );

  if (dryRun || stale.length === 0) {
    console.log(dryRun ? "--- DRY RUN, nothing written ---" : "nothing to do");
    process.exit(0);
  }

  const { error: updateError } = await db
    .from("ir_watches")
    .update({ next_directions: directions })
    .in(
      "id",
      stale.map((w: { id: string }) => w.id)
    );
  if (updateError) {
    console.error("update failed", updateError);
    process.exit(1);
  }

  console.log(`filled next_directions on ${stale.length} watches`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
