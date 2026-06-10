# Watchtower — L3 Scheduled Investigation — Design

Status: proposed 2026-06-10, awaiting review (Claude Code + Elios).
Constitutional basis: `docs/zeno-constitution-amendment-v1.md` — Autonomy Ladder L3 (自发巡检), Iron Law 0 (read-only autonomy), §2a (confirmation is rationed), §2d (autonomy bounded by confirmed intent), E3 (`retrieved_at` is the L3 hook).
Depends on: L2 Research Brief shipping first (`2026-06-10-research-engine-l1-l2-design.md`) — the `evidence` table, `research_run` records, persisted plans, and topic charters are the only hooks L3 needs, all already reserved there.

## Goal

Zeno periodically re-investigates the parts of the graph that the outside world can invalidate, and reports "this assumption may have been overturned" — without the user asking, without flooding the user, and without ever touching truth.

Two trigger modes:

- **Zeno-initiated (suggested watches):** Zeno continuously identifies nodes whose validity depends on external conditions and whose failure would cascade, and puts them under cheap patrol automatically.
- **User-requested watches:** the user says "keep an eye on this" — on any node from the Truth Graph, or from a dedicated management area.

Both kinds of watch live in one visible place (the **Watchtower**), each with its own cadence, reasoning tier, and off switch.

## Core design judgment: what deserves a watch

**Watch-worthiness is a property of a node's grounding, not its kind.** A node qualifies when:

> **external exposure** (its validity depends on ≥1 externally falsifiable condition) × **blast radius** (how many active truths/plans transitively depend on it via `depends_on` / `supports` / `blocks` edges) is high enough.

This formalizes the requirement's "Dependency" criterion: the dependency graph IS the priority function.

Kind acts only as a prior for *auto-suggestion*:

| Kind | Auto-suggest | Rationale |
|---|---|---|
| `hypothesis` | yes (default) | an unverified belief exists to be falsified |
| `constraint` with external grounding | yes — **highest priority** | platform policy / pricing / regulation / API limits; downstream plans collapse when these move |
| `constraint` (user-willed, e.g. budget) | no | nothing external can falsify it |
| `rejection` whose rationale cites an external fact | yes — **reversal watch (翻案)** | "rejected X because Y" goes stale when Y changes; this is opportunity-cost alerting and a differentiator |
| `open_question` | user-requested only | not a freshness problem — a *standing query* ("keep looking for an answer"), implemented as a recurring L2 run on the same watch infrastructure |
| `plan` | never directly | covered transitively: watch its dependencies, propagate alerts along edges |
| `goal` / `principle` | never auto (§2d — agenda belongs to the user); user may force | Zeno monitoring "is your goal still valid" is agenda-setting |

Operational triggers for Zeno to *suggest* a watch (any one suffices):

1. The node has attached L2 evidence (`retrieved_at` exists) → freshness patrol of that evidence.
2. Its rationale cites a falsifiable external condition (extraction tags `external_dependency` going forward).
3. Its blast radius exceeds a threshold (transitive closure over `ir_edges` to active nodes).

`watch_priority = exposure × blast_radius × evidence_age` — patrol ordering and budget allocation follow this score, recomputed at patrol time.

## Decisions (locked unless review overturns)

- **No floating watches.** Every watch anchors to exactly one `ir_nodes` row (E2-isomorphic). "Watch this URL" requests are landed by first attaching the URL to a node (usually an `open_question` or `constraint`) and watching that.
- **Patrol is automatic; expensive escalation is user-armed.** Zeno-initiated watches run at the cheapest tier (patrol-only, `report_only`) without asking — investigation is Zeno's job (Law 0) and patrol cost is bounded. But raising a watch's escalation tier (auto-spending flagship reasoning on signals) is a user action. This keeps heavy token spend behind user intent (§2d) without making patrol itself need permission.
- **Patrol frequency and alert frequency are decoupled (§2a).** Patrol may run daily; alerts are scarce: per-signal dedupe, per-node cooldown, per-project weekly alert cap, alerts ranked by blast radius. Watchtower alert confirm-rate is the L3 health metric — if it degrades, the system tightens alert admission automatically (it must NOT learn to write more agreeable alerts; alerts always carry the contradicting evidence itself, §2b).
- **All writes remain candidate/evidence.** A signal never changes a node's status. The maximal output is an alert candidate ("hypothesis X may be overturned") carrying contradicting evidence and a suggested action (revisit / supersede), confirmed or dismissed by the user like any candidate.
- **"Realtime" is approximated, not promised.** True realtime monitoring is out of scope; adaptive cadence (below) is the honest version within budget.
- **Cost routing reuses the pre-staged tiers** in `lib/ai/model-policy.ts`: patrol → `research_worker` (economy; add a `watch_patrol` slot), escalation investigate → standard, deep-dive judge → `research_synthesis` (frontier). Never affected by the foreground quality knob.

## Reasoning tiers (per-watch, user-tunable)

Three plain-language levels, each with a cost hint in the UI (易学易用: no model names exposed):

1. **Sentinel / 哨兵** (economy) — re-fetch known sources, diff stored verbatim quotes (is the quote still present? has the page materially changed?), cheaply re-run the persisted L2 search intents. Output: signal / no-signal. No signal → silent log entry only.
2. **Investigate / 追查** (one bounded L2-style run) — on signal, run a focused research pass around the signal: fresh evidence, short brief, stance judgment.
3. **Deep dive / 深究** (frontier judge) — on signal, multi-step adversarial evaluation: "is this assumption actually overturned?", chase the lead across sources, produce a reversal-grade alert candidate with the full evidence chain.

A watch's `signal_response` setting decides what happens after a Sentinel signal: `report_only` (default for Zeno-initiated watches — the signal itself becomes a low-cost alert candidate) | `investigate` | `deep_dive`. This is the requirement's "调查到线索之后，启用什么量级的推理" knob.

## Watchtower (management area)

- Dedicated panel: one row per watch — target node, origin badge (Zeno / you), the **reason** ("why I'm watching this": the dependency chain summary, mandatory for Zeno-initiated watches — agenda transparency per §2d), cadence, reasoning tier dial, last patrol, last signal, spend to date, on/off toggle.
- Header: global kill switch + monthly autonomous-budget meter.
- Sorted by `watch_priority`; exhausted/paused watches visibly flagged, never silently dropped.

Truth Graph integration:

- Watched nodes get a subtle radar glyph on the canvas.
- Node detail pane gains a **Monitoring** section: toggle, tier, patrol history (reuses the planned Evidence section layout).
- Watch-eligible nodes get a "Watch this" action; user-forced watches on `goal`/`principle` are allowed but never suggested.
- Alert candidates render distinctly (`source = "zeno_watchtower"`), like `mcp_agent` and `zeno_research` candidates.

## Data model (drizzle-kit migration, on top of L2's)

- `watch`: `id`, `project_id`, `node_id` (NOT NULL → `ir_nodes.id`, text — no floating watches; follows the dual-track ruling that `ir_nodes` is canonical), `origin` (`zeno_suggested | user_requested`), `reason` (text, shown in UI), `cadence` (`daily | every_3_days | weekly | monthly`) + adaptive backoff state, `signal_response` (`report_only | investigate | deep_dive`), `status` (`active | paused | exhausted | dismissed`), `priority` (real, snapshot), `budget` (jsonb caps), `spend_to_date`, `last_patrol_at`, `last_signal_at`, `next_due_at`, `created_by`, timestamps.
- `research_run` gains `run_type` (`research | patrol | escalation`) and nullable `watch_id` FK — patrols and escalations are just runs; the Watchtower renders from `watch` + `research_run`, no new activity infrastructure.
- Signals are not a separate table in V1.5: a signal is a patrol run whose result is non-empty; dedupe via a content-hash on the signal payload stored on the run.

## Scheduling & budget

- One Vercel Cron endpoint (daily to start) sweeps due watches in priority order within the global budget. 300s function budget: process N watches per invocation with a persisted cursor; self-chain if needed (open question below).
- **Adaptive cadence:** consecutive no-signal patrols back off the interval (cap at monthly); a signal tightens it. This is the main token-saving lever after tiering.
- **Fetch dedupe across watches:** the same source URL watched via multiple nodes is fetched once per patrol batch.
- **Watch wallet:** per-project monthly autonomous budget. Exhaustion → all watches `paused` + a Watchtower banner; never silent. Per-run caps inherit L2's.

## Acceptance criteria

- [ ] A `hypothesis` with L2 evidence automatically appears in the Watchtower as a suggested watch with a human-readable reason; patrol runs on schedule at economy tier.
- [ ] A patrol that detects a vanished/changed verbatim quote produces a signal; with `report_only` an alert candidate (with the evidence diff) lands; with `investigate`/`deep_dive` the corresponding run executes within caps.
- [ ] The same signal does not re-alert within its cooldown; weekly alert cap enforced; alert candidates carry contradicting evidence inline.
- [ ] Per-node off switch (detail pane) and global kill switch work; budget exhaustion pauses visibly.
- [ ] Zero truth writes; all outputs are evidence or candidates (`zeno_watchtower`).
- [ ] Alert confirm-rate telemetry from day one (the L3→L4 ladder gate).

## Open questions

- **Engineering:** cron batch continuation pattern (cursor + self-chain vs Vercel Queues) — decide against measured patrol cost per watch.
- **Engineering:** robust "page materially changed" detection — content hash + quote-presence check + a cheap LLM relevance pass; tune the false-positive rate before enabling `investigate` defaults.
- **Product (non-blocking):** standing-query watches on `open_question` (recurring L2 rather than freshness patrol) — same infra, different copy; ship in V1.5 or fast-follow?
- **Data (non-blocking):** evidence retention when patrols re-verify the same claim repeatedly — supersede old evidence rows or version them?

## Phasing

- V1.5, estimated ~2–3 weeks **after L2 ships** (hard dependency: evidence table, research pipeline, run records, model-policy slots).
- Ladder gate (constitution §4): enable per-project only where L1/L2 confirm-rates are healthy.
