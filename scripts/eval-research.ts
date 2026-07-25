/**
 * Quote-gate evaluation harness for the research pipeline.
 *
 * Measures, over a fixed question set, what fraction of model-extracted
 * evidence quotes fail verbatim verification (verifyQuote) against the fetched
 * page — i.e. the unverifiable-claim rate that WOULD reach the research brief
 * without the quote gate. With the gate on (production behavior), that rate is
 * 0% by construction: every failing quote is dropped before the judge phase.
 *
 * Runs the SAME code the production collect phase runs: searchWeb →
 * fetchPageText → extractEvidenceItems → verifyQuote.
 *
 * Run (live, spends search + extraction tokens):
 *   NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/eval-research.ts
 *
 * Options:
 *   --questions <path>   JSON array of question strings (default: built-in set)
 *   --max-fetches <n>    pages fetched per question (default 4)
 *   --from-logs          aggregate droppedQuotes/evidence from past production
 *                        runs recorded in ir_extraction_events instead of
 *                        running live (needs Supabase service-role env)
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const DEFAULT_QUESTIONS = [
  "What context window sizes do Claude Sonnet 4.6 and GPT-4.1 support?",
  "Does Next.js 16 support partial prerendering in production?",
  "What are the rate limits of the Supabase free tier in 2026?",
  "How does Drizzle ORM handle Postgres migrations compared to Prisma?",
  "What is the current pricing of Amazon Bedrock for Claude models?",
];

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function runLiveEval() {
  // Imports are deferred so dotenv populates process.env first.
  const { selectModelForTask } = await import("../lib/ai/model-policy");
  const { extractEvidenceItems } = await import("../lib/research/extract");
  const { fetchPageText } = await import("../lib/research/fetch-page");
  const { searchWeb } = await import("../lib/research/search");
  const { verifyQuote } = await import("../lib/research/text");
  const { computeQuoteGateStats, formatQuoteGateReport } = await import(
    "../lib/research/eval-metrics"
  );

  const questionsPath = readFlag("--questions");
  const questions: string[] = questionsPath
    ? JSON.parse(
        await import("node:fs").then((fs) =>
          fs.promises.readFile(questionsPath, "utf8")
        )
      )
    : DEFAULT_QUESTIONS;
  const maxFetches = Number(readFlag("--max-fetches") ?? 4);

  // Routing now happens per call inside extractEvidenceItems, so this is the
  // model the eval will *start* on — a degrade mid-eval is reported by the
  // model_routing log lines, not here.
  const modelId = selectModelForTask("research_worker");
  console.log(`Extraction model (primary route): ${modelId}`);
  console.log(
    `Questions: ${questions.length}, max fetches/question: ${maxFetches}\n`
  );

  const results: Array<{
    question: string;
    extracted: number;
    verified: number;
    dropped: number;
  }> = [];

  for (const question of questions) {
    process.stdout.write(`- ${question}\n`);
    let extracted = 0;
    let verified = 0;
    let dropped = 0;

    const outcome = await searchWeb(question);
    const urls = outcome.results.map((r) => r.url).slice(0, maxFetches * 2);

    let fetched = 0;
    for (const url of urls) {
      if (fetched >= maxFetches) {
        break;
      }
      const page = await fetchPageText(url);
      if (!page) {
        continue;
      }
      fetched++;

      try {
        const extraction = await extractEvidenceItems({
          preferredModelId: null,
          originQuestion: question,
          url,
          pageText: page.text,
        });

        for (const item of extraction.items) {
          extracted++;
          if (verifyQuote(item.quote, page.text)) {
            verified++;
          } else {
            dropped++;
          }
        }
      } catch {
        process.stdout.write(`  (extraction failed for ${url}, skipped)\n`);
      }
    }

    process.stdout.write(
      `  pages: ${fetched}, extracted: ${extracted}, verified: ${verified}, dropped: ${dropped}\n`
    );
    results.push({ question, extracted, verified, dropped });
  }

  console.log(`\n${formatQuoteGateReport(computeQuoteGateStats(results))}`);
}

async function runFromLogs() {
  const { getSupabaseAdminClient } = await import("../lib/supabase/admin");
  const { computeQuoteGateStats, formatQuoteGateReport } = await import(
    "../lib/research/eval-metrics"
  );

  const db = getSupabaseAdminClient() as any;
  const { data, error } = await db
    .from("ir_extraction_events")
    .select("metadata, created_at")
    .eq("event", "research_run_completed")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`Failed to read ir_extraction_events: ${error.message}`);
  }

  const results = (data ?? [])
    .map(
      (row: {
        metadata: Record<string, unknown> | null;
        created_at: string;
      }) => {
        const meta = row.metadata ?? {};
        const verified = Number(meta.evidenceCount ?? 0);
        const dropped = Number(meta.droppedQuotes ?? 0);
        return {
          question: `run ${String(meta.runId ?? "?").slice(0, 8)} (${row.created_at.slice(0, 10)})`,
          extracted: verified + dropped,
          verified,
          dropped,
        };
      }
    )
    .filter((r: { extracted: number }) => r.extracted > 0);

  console.log(`Aggregating ${results.length} production research runs:\n`);
  console.log(formatQuoteGateReport(computeQuoteGateStats(results)));
}

const main = process.argv.includes("--from-logs") ? runFromLogs : runLiveEval;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
