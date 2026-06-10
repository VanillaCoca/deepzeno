# Research Engine — L1 Kickoff + L2 Research Brief — Design

Status: proposed 2026-06-10, awaiting review (Claude Code + Elios).
Constitutional basis: `docs/zeno-constitution-amendment-v1.md` (Iron Law 0 — proactive diligence, read-only autonomy; Evidence citizenship; Autonomy Ladder L1/L2).

## Goal

Turn Zeno from a passive judgment-capture tool into an actively diligent one, in two bounded steps:

- **L1 Kickoff** — when a project is created, Zeno interviews the user, proposes a topic decomposition, and seeds each topic with open questions / constraints / goals as candidates. Kills the empty-graph cold start. **Launch gate.**
- **L2 Research Brief** — on a node, the user clicks "Research this"; Zeno plans a research approach, runs read-only web research, and lands a sourced brief: evidence + option comparison + proposed candidates, all attached to the originating node. **First post-launch milestone (~30 days).**

L3 (assumption watchlist / self-initiated patrol) and L4 (adversarial check) are explicitly out of scope here; this design must not block them (see Future considerations).

## Decisions (locked unless review overturns)

- **Autonomy boundary:** read-only web access only (search + fetch). All outputs enter as idea / candidate / evidence. No truth writes, ever (Iron Law 0 / 4).
- **Web tooling:** provider-native web search via AI SDK 6 (Anthropic `web_search`; OpenAI web search as fallback). No third-party search vendor (Tavily/Exa) in V1.x — platform keys only, one less vendor, billed per use. Keep the tool behind a thin internal interface so a vendor can be added later without touching the pipeline.
- **Evidence becomes a first-class table.** The existing `candidate_decision.external_evidence` text column (`lib/db/schema.ts:344`) is kept for MCP back-compat and marked deprecated.
- **Cost architecture:** cheap-collect / expensive-judge, wired to the task slots already pre-staged in `lib/ai/model-policy.ts` (`selectModelForTask`): collection/summarization → `research_worker` (economy), planning → `research_plan` (standard), synthesis → `research_synthesis` (frontier). Standard tier is enough for decomposing one question into search intents; synthesis is the expensive judge. Research tiers are fixed per stage and NOT affected by the foreground Economy/Balanced/Best knob (consistent with the P2 auto-routing spec: background tasks keep fixed tiers).
- **Question over assertion:** when the model is unsure during kickoff or synthesis, it must emit `open_question`, not `hypothesis`. Asking is the safe "miss"; asserting is "making it up" (Iron Law 2 mapped to research).
- **No fabricated sourcing:** if the web tool is unavailable or returns nothing usable, the run fails visibly. Zeno never emits a knowledge-only brief dressed up as research.

## Component 1 — L1 Kickoff (launch gate)

### User stories

- As a project owner, when I create a project I answer a handful of intake questions so Zeno understands my intent before decomposing it.
- As a project owner, I receive a proposed topic decomposition, and each topic comes seeded with open questions / constraints / goals as candidates — my graph is never empty.
- As a project owner, I can skip the intake entirely; project creation never blocks on it.

### Flow

1. **Intake.** After project creation (`lib/actions/project-creation.ts` → General topic provisioning), Zeno opens the General-topic sandbox with one message containing up to 5 sharp intake questions (consultant-style: goal, constraints, deadline, what's already decided, what success looks like). User replies free-form in one or more messages. A "Skip — start blank" affordance is always visible.
2. **Kickoff synthesis.** One structured-output run (flagship tier) over the intake exchange produces:
   - `topics[]` — proposed topic decomposition: name + one-line charter ("what question this topic exists to answer"). The charter is the seed of the topic's *research methodology* — it tells future L2/L3 runs what this topic is trying to find out.
   - `nodes[]` — per topic: `open_question` / `constraint` / `goal` / `hypothesis` proposals with rationale and confidence. Confidence ≥ threshold → candidate; below → idea (reuse the existing funnel thresholds in the extraction path).
3. **Confirmation.** Proposals land in the existing IR review surfaces (Truth Graph pending/idea + detail pane); topics are created through the existing topic provisioning path upon user confirmation. Nothing is created as truth.

### Implementation notes

- **Track ruling applied:** kickoff proposals land on the IR track — `ir_nodes` with status `pending` (high confidence) / `idea` (medium), `sourceLayer: "kickoff"`. The legacy `candidate_decisions` funnel is not used (dual-track ruling, see Open questions).
- Reuse from the extraction infrastructure: the structured-output pattern (`generateObject` + zod schema), the sweep confidence funnel (high_confidence → `pending`, medium_confidence → `idea`; `lib/ir/sweep.ts`), and model routing via `selectModelForTask`. Kickoff is a new prompt + schema over that *pattern* — but the orchestration around it is new code, not reuse (next bullet).
- **New orchestration — landing nodes under topics that don't exist yet.** `ir_nodes.topicId` is nullable, but the sweep path punts on proposed topics: it parses `topic_route: "new_topic_seed"` and drops those items to the unassigned pool instead of creating topics (`lib/ir/sweep.ts:635-638`). Kickoff therefore lands in two steps: (1) the user confirms the proposed decomposition → topics are created through the existing provisioning path; (2) node proposals are then inserted as `ir_nodes` under their real `topicId`s. No existing path does this.
- **Charter storage:** `topics.description` (`lib/db/schema.ts:146`) exists and is nullable — L1 stores the charter there, no migration needed. If it proves overloaded (user-edited description vs machine-read charter), promote charter to its own column in the L2 migration.
- Kinds restricted to `open_question` / `goal` / `constraint` / `hypothesis`. No `plan` (premature) and no `rejection` (rejections require user history; consistent with the extraction prompt rule that rejections are never pre-selected).
- i18n: EN / 中文 / Français strings via the existing locale system.
- Telemetry from day one: seeded count, confirmed count, dismissed count per project. **Confirm-rate is the funnel's core health metric** and the gate for unlocking L3 later (Autonomy Ladder rule).

### Acceptance criteria

- [ ] A new project with completed intake yields ≥1 proposed topic decomposition and ≥5 seeded nodes (candidates/ideas) within the first session.
- [ ] Zero auto-truth: confirming a kickoff proposal goes through exactly the same flow as any other candidate.
- [ ] Skip path works; a skipped project behaves exactly like today's blank project.
- [ ] Kickoff proposals carry `sourceLayer: "kickoff"` (distinct from `inline`/`sweep`/`manual`/`mcp`) and render with a distinct origin hint, like `mcp_agent` candidates do today.
- [ ] Works in all three locales.

### Non-goals (L1)

No web access. No background jobs — kickoff synthesis is one synchronous run. No automatic topic creation without confirmation.

## Component 2 — L2 Research Brief (post-launch milestone 1)

### User stories

- As a project owner, I click **Research this** on an `open_question` (or `hypothesis`) node and get back a sourced brief: options compared, evidence attached, candidates proposed — all anchored to that node.
- As a project owner, every claim in the brief links to a source with a verbatim quote and a `retrieved_at` timestamp, so I can verify before I confirm anything.
- As a project owner, I can see what a research run cost and what it looked at, so I trust (or correct) Zeno's diligence.

### Pipeline (four phases, budget-capped)

1. **Plan** (standard tier — `research_plan` in `lib/ai/model-policy.ts`). Given the node, its topic charter, and relevant confirmed truth (reuse the context-assembly path in `lib/context-assembly.ts` — note it clamps assembled context at 18,000 chars, so large projects feed the planner a truncated view; acceptable for V1.x, revisit if plan quality suffers), decompose the question into ≤N search intents. The plan is persisted on the run record — the user can inspect *how* Zeno decided to investigate, and future runs on the same topic can reuse or refine it.
2. **Collect** (economy tier + provider `web_search` tool). Execute searches, fetch top sources, extract evidence items: `{url, title, quote, claim, stance, retrieved_at}`.
   - **Anti-hallucination rule:** `quote` must be verbatim from *fetched page content*, never from search-result snippets. Evidence that can't be quote-verified is dropped (prefer to miss).
3. **Judge** (flagship tier). Synthesize: a brief (when the question is a choice, an options table — each option with pros/cons and evidence references) plus proposed candidates (`hypothesis` / `constraint` / `plan` / `rejection`), each carrying `suggested_edges` pointing at the origin node and links to supporting evidence.
4. **Land.** Evidence rows inserted; proposed candidates enter as `ir_nodes` (status `pending`/`idea`, `sourceLayer: "research"`); the brief renders in the node's detail pane (new Evidence section); the run is logged as an agent-activity item (reuse `lib/agent-activity.ts` surfaces) so there is operator visibility of every run and every failure (closes a phase-2 TODO about silent extraction failures).

### Data model (drizzle-kit migration)

- `research_run`: `id`, `project_id`, `topic_id`, `origin_node_id` (text, NOT NULL → `ir_nodes.id`; the origin may be pending or active), `plan` (jsonb — the persisted search intents), `status` (`running | done | partial | failed`), `budget` (jsonb snapshot), `cost_estimate`, `models_used` (jsonb), `created_at`, `finished_at`.
- `evidence`: `id`, `project_id`, `run_id` → `research_run`, `node_id` (text, NOT NULL → `ir_nodes.id`), `url`, `title`, `quote`, `claim`, `stance` (`supports | contradicts | neutral`), `retrieved_at`, `created_at`. A single NOT NULL FK satisfies E2 (no floating evidence) — the IR track holds candidates and truths in one table, so no nullable two-FK split is needed.
- `retrieved_at` is the L3 hook: the future watchlist is "re-verify old evidence", nothing more.
- FK design follows the dual-track ruling (`ir_nodes` canonical — see Open questions, resolved).

### Budgets and failure modes

Env-tunable caps with defaults: max search calls 6, max fetched pages 10, max proposed candidates 5, hard token/cost ceiling per run. Over budget → abort and land partial results with `status = "partial"` — never a silent failure.

| Failure mode | Mitigation |
|---|---|
| Hallucinated citations | fetch-verified verbatim quotes only |
| Low-quality sources | judge-phase source filter; domain heuristics later if needed |
| Stale evidence | `retrieved_at` stamped; freshness is L3's job |
| Runaway cost | per-run caps + cost recorded on the run |
| Web tool unavailable | run fails visibly; no unsourced briefs |
| Vercel function timeout | see Open questions — likely chunked phases with progress persisted between invocations |

### Acceptance criteria

- [ ] From one `open_question`, a default-budget run produces a brief + ≥3 quote-verified evidence items + ≥1 proposed candidate, all attached to the origin node.
- [ ] Every evidence item has `url` + verbatim quote + `retrieved_at`.
- [ ] Over-budget and failed runs are visible in agent activity with their status; partial results land.
- [ ] Research candidates render distinctly (`sourceLayer: "research"`), like `mcp_agent` candidates today.
- [ ] No truth writes; no non-GET side effects on the external world.
- [ ] Run cost is recorded; target ceiling set after first real measurements (instrument first, then cap tighter).

### Success metrics

- L1: time-to-first-confirmed-truth for new projects; kickoff confirm-rate (target: >50% of seeded candidates acted on — confirmed or consciously dismissed — in session 1).
- L2: research-run completion rate; evidence→confirm conversion (% of research-spawned candidates confirmed); repeat usage (projects with ≥2 runs in week 1).
- North star (from strategy memo): week-4 confirm activity per project.

## Open questions

- **RESOLVED (2026-06-10, Elios): dual-track candidate pool ruling → `ir_nodes` is canonical.** Evidence basis: the Truth Graph canvas, context assembly (`lib/context-assembly.ts`), and the chat flow all read/write the IR track only; the `decisions` table has no live UI reader. Consequences: kickoff and research outputs land as `ir_nodes` (status `pending`/`idea`); `evidence` and `research_run` FKs target `ir_nodes` (text ids); `decisions`/`candidate_decisions`/`edges` are slated for retirement and MCP migrates to the IR track (separate workstream, see constitution-compliance fixes).
- **Engineering (blocking for L2):** long research runs vs Vercel function limits — single long-running handler with resumable progress, or phase-per-invocation with state on `research_run`? Recommend deciding against the existing resumable-streams/Redis infra. Note: default function timeout is now 300s on all plans (Fluid Compute), so a default-budget run (≤6 searches, ≤10 fetches) likely fits one invocation — chunked phases are a defensive fallback, not a precondition.
- **Design (non-blocking):** brief rendering in the detail pane vs a wider panel — must obey the 易学易用 supreme creed; default to detail pane until it visibly fails.
- **Product (non-blocking):** expose `run_research` via MCP so coding agents can request research? Design-compatible (it's just another trigger), deliberately not in V1.x.
- **Data (non-blocking):** evidence dedupe/retention policy across runs on the same node.

## Future considerations (architectural insurance, not commitments)

- **L3 watchlist:** per-topic watched sources (specific sites/forums Zeno patrols) + scheduled re-verification of evidence. The `evidence.retrieved_at` field, persisted run plans, and topic charters are the only hooks it needs from this design. Full design now exists: `2026-06-10-watchtower-l3-design.md` (Watchtower — scheduled investigation).
- **L4 adversarial check (Council, redefined):** a judge-phase variant run against a candidate before confirmation.
- **Multi-vendor search / BYO search keys:** behind the thin tool interface.

## Phasing

- **L1:** ~5–8 working days. The structured-output/funnel reuse is real, but topic-creation-on-confirm orchestration is new code and the dual-track ruling gates the start (see Implementation notes / Open questions). Ships inside the V1 launch gate.
- **L2:** ~2–3 weeks including migration, pipeline, and detail-pane Evidence UI. First post-launch milestone; precondition for the non-developer vertical narrative.
